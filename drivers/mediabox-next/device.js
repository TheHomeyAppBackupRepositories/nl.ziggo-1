'use strict';

const Homey = require('homey');
const Ziggo = require('../../lib/Ziggo');

module.exports = class MediaboxNextDevice extends Homey.Device {

  async onInit() {
    this.log('MediaboxNextDevice has been inited');
    this.registerCapabilityListener('onoff', this.onCapabilityOnOff.bind(this));

    await this.onZiggoInit();
  }

  async onZiggoInit() {
    try {
      if (this.ziggo)
        this.ziggo.destroy();

      const {
        username,
        password,
      } = await this.getSettings();

      this.ziggo = new Ziggo({
        username,
        password,
      });

      this.ziggo.on('message', this.onZiggoMessage.bind(this));

      await this.ziggo.ensureMqttClient();

      this.setAvailable();
    } catch (err) {
      this.setUnavailable(err);
    }
  }

  onZiggoMessage(message) {
    this.log('onZiggoMessage', message);

    const {
      deviceType,
      source,
      state,
    } = message;

    if (deviceType === 'STB') {
      if (state.startsWith('ONLINE_STANDBY')) {
        this.setCapabilityValue('onoff', false).catch(this.error);
      } else if (state.startsWith('OFFLINE')) {
        this.setCapabilityValue('onoff', false).catch(this.error);
      } else if (state.startsWith('ONLINE')) {
        this.setCapabilityValue('onoff', true).catch(this.error)
      };
    }
  }

  async setChannel({ channelId }) {
    return this.ziggo.setChannel({ channelId });
  }

  async onCapabilityOnOff(value) {
    return this.ziggo.toggleOn();
  }

  async onDeleted() {
    if (this.ziggo)
      this.ziggo.destroy();
  }

  async onSettings(oldSettings, newSettings) {
    const {
      username,
      password,
    } = newSettings;

    const ziggo = new Ziggo({ username, password });
    await ziggo.getSession();

    this.onZiggoInit();
  }

}