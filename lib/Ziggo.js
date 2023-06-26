'use strict';

const { EventEmitter } = require('events');
const fetch = require('node-fetch');
const mqtt = require('mqtt');

const URL_SESSION = 'https://prod.spark.ziggogo.tv/auth-service/v1/authorization';
const URL_JWT = 'https://prod.spark.ziggogo.tv/auth-service/v1/mqtt/token';
const URL_CHANNELS = 'https://prod.spark.ziggogo.tv/eng/web/linear-service/v2/channels?cityId=65535&language=nl&productClass=Orion-DASH';
const URL_MQTT = 'wss://obomsg.prod.nl.horizon.tv:443/mqtt';

module.exports = class Ziggo extends EventEmitter {

  constructor({ username, password }) {
    super();

    this.username = username;
    this.password = password;
    this.clientId = this.constructor.makeId(30);
    this.setTopBoxId = null;
  }

  static async getChannels() {
    const res = await fetch(URL_CHANNELS);
    if (!res.ok)
      throw new Error(res.statusText);

    const json = await res.json();

    return json.map(channel => {
      //const { station } = channel.stationSchedules[0];
      //const image = station.images.find(image => image.assetType === 'station-logo-large');
      //note: stations are gone 

      return {
        channelTitle: channel.name,
        channelNumber: channel.logicalChannelNumber,
        channelId: channel.id,
        image: channel.logo.focused,
      };
    });
  }

  static makeId(length) {
    let result = '';
    let characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
  };

  destroy() {
    if (this.mqttClient)
      this.mqttClient.end();

    this.mqttClient = null;
    this.mqttToken = null;
    this.session = null;
    this.setTopBoxId = null;

    this.removeAllListeners();
  }

  /*
   * Session
   */

  async ensureSession() {
    if (!this.session)
      await this.getSession();
  }

  async getSession() {
    const res = await fetch(URL_SESSION, {
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
        'x-device-code': 'web',
      },
      body: JSON.stringify({
        username: this.username,
        password: this.password,
      }),
    });

    const json = await res.json();

    if (!res.ok) {
      if (json && json.length && json[0].code === 'invalidCredentials')
        throw new Error('Invalid Credentials');

      throw new Error(res.statusText);
    }

    this.session = json;
    this.mqttUsername = this.session.householdId;

    return this.session;
  }

  async ensureMQTTToken() {
    if (!this.mqttToken)
      await this.getMQTTToken();
  }

  async getMQTTToken() {
    if (!this.session)
      await this.getSession();

    const res = await fetch(URL_JWT, {
      headers: {
        'X-OESP-Token': this.session.accessToken,
        'X-OESP-Username': this.username,
      },
    });

    if (!res.ok)
      throw new Error(res.statusText);

    const { token } = await res.json();
    this.mqttToken = token;
  }

  /*
   * MQTT
   */

  async ensureMqttClient() {
    await this.ensureSession();
    await this.ensureMQTTToken();

    if (this.mqttClient)
      return;

    await new Promise((resolve, reject) => {
      this.mqttClient = mqtt.connect(URL_MQTT, {
        connectTimeout: 10 * 1000, // 10 seconds
        clientId: this.clientId,
        username: this.mqttUsername,
        password: this.mqttToken,
      });

      this.mqttClient
        .on('connect', () => {
          this.mqttClient.subscribe(`${this.mqttUsername}`, err => {
            if (err) return reject(err);
          });

          this.mqttClient.subscribe(`${this.mqttUsername}/+/status`, (err) => {
            if (err) return reject(err);
          });
        })
        .on('message', (topic, payload) => {
          try {
            payload = JSON.parse(payload);
            this.emit('message', payload);

            if (payload.deviceType === 'STB' && payload.source)
              this.setTopBoxId = payload.source;

            if (payload.deviceType === 'STB' && payload.state === 'ONLINE_RUNNING')
              resolve();
          } catch (err) {
            console.error('MQTTClient Parse error:', err);
          }
        })
        .on('error', err => {
          console.error('MQTTClient Error:', err);
          // this.mqttClient.end();
        })
        .on('close', () => {
          console.error('MQTTClient Close');
          this.mqttClient.end();

          this.mqttClient = null;
          this.mqttToken = null;
          this.session = null;
          this.setTopBoxId = null;
        });
    });
  }

  async publish(args) {
    await this.ensureMqttClient();

    const id = this.constructor.makeId(8);

    const payload = {
      id,
      source: {
        clientId: this.clientId,
        friendlyDeviceName: 'Homey',
        ...args.source,
      },
      ...args,
    };

    await new Promise((resolve, reject) => {
      this.mqttClient.publish(`${this.mqttUsername}/${this.setTopBoxId}`, JSON.stringify(payload), err => {
        if (err) return reject(err);
        return resolve();
      });
    });
  }

  /*
   * Commands
   */

  async setChannel({ channelId }) {
    return this.publish({
      type: 'CPE.pushToTV',
      status: {
        sourceType: 'linear',
        source: {
          channelId,
        },
        relativePosition: 0,
        speed: 1,
      },
    });
  }

  async toggleOn() {
    return this.sendKey({
      key: 'Power',
    })
  }

  async pause() {
    return this.sendKey({
      key: 'MediaPause',
    })
  }

  async escape() {
    return this.sendKey({
      key: 'Escape',
    })
  }

  async sendKey({ key }) {
    return this.publish({
      type: 'CPE.KeyEvent',
      status: {
        w3cKey: key,
        eventType: 'keyDownUp',
      },
    }).catch(err => {
      console.error('publishError', err);
      throw err;
    });
  }

}
