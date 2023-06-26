'use strict';

const Homey = require('homey');
const Ziggo = require('../../lib/Ziggo');

module.exports = class MediaboxNextDriver extends Homey.Driver {

  async onInit() {
    this.log('MediaboxNextDriver has been inited');

    this.homey.flow.getActionCard('set_channel')
      .registerRunListener(async ({ device, channel }) => {
        return device.setChannel({
          channelId: channel.id,
        });
      })
      .getArgument('channel')
      .registerAutocompleteListener(async query => {
        const channels = await Ziggo.getChannels();
        return channels.filter(channel => {
          return channel.channelTitle.toLowerCase().includes(query.toLowerCase());
        }).map(channel => {
          return {
            id: channel.channelId || channel.serviceId,
            name: channel.channelTitle,
            image: channel.image,
          };
        });
      });
  }

  onPair(socket) {
    let username;
    let password;
    let householdId;

    socket.setHandler('login', async data => {
      username = data.username;
      password = data.password;

      try {
        const ziggo = new Ziggo({ username, password });
        const session = await ziggo.getSession();

        householdId = session.householdId;
        this.log(`Household ID: ${householdId}`);

        return true;
      } catch (err) {
        this.error(err);
        return false;
      }
    });

    socket.setHandler('list_devices', async () => {
      return [{
        name: 'Ziggo Mediabox Next',
        data: {
          id: householdId,
        },
        settings: {
          username,
          password,
        },
      }];
    });
  }

}