'use-strict';

import moment from 'moment';
import { customAlphabet } from 'nanoid/async';

import Cleartimer from '../../../common/cleartimer.js';
import fs from 'fs-extra';

import Database from '../../database.js';
import mongoose from 'mongoose';
const { Schema } = mongoose;

mongoose.connect('mongodb://192.168.0.150:27017/infraspec', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const notificationSchema = new Schema({
  message: String,
  id: String,
  camera: String,
  fileName: String,
  name: String,
  extension: String,
  recordStoring: Boolean,
  recordType: String,
  room: String,
  time: String,
  date: Date,
  timeStamp: Number,
  label: String,
});

const Notification = mongoose.model('Notification', notificationSchema);
await Notification.createCollection();

const nanoid = customAlphabet('1234567890abcdef', 10);
const notificationsLimit = 100;

export const list = async (query) => {
  // eslint-disable-next-line unicorn/consistent-function-scoping
  const GetSortOrder = (property) => {
    return (a, b) => {
      if (a[property] < b[property]) {
        return 1;
      } else if (a[property] > b[property]) {
        return -1;
      }
      return 0;
    };
  };

  let notifications = await Database.interfaceDB.chain.get('notifications').cloneDeep().value();
  notifications.push(...Database.notificationsDB.chain.get('notifications').cloneDeep().value());
  notifications.sort(GetSortOrder('timestamp'));

  if (moment(query.from, 'YYYY-MM-DD').isValid()) {
    notifications = notifications.filter((notification) => {
      const date = moment.unix(notification.timestamp).format('YYYY-MM-DD');
      const dateMoment = moment(date).set({ hour: 0, minute: 0, second: 1 });

      let fromDate = query.from;
      let toDate = moment(query.to, 'YYYY-MM-DD').isValid() ? query.to : moment();

      if (moment(toDate).isBefore(fromDate)) {
        toDate = query.from;
        fromDate = moment(query.to, 'YYYY-MM-DD').isValid() ? query.to : moment();
      }

      const fromDateMoment = moment(fromDate).set({ hour: 0, minute: 0, second: 0 });
      const toDateMoment = moment(toDate).set({ hour: 23, minute: 59, second: 59 });

      const isBetween = dateMoment.isBetween(fromDateMoment, toDateMoment);

      return isBetween;
    });
  }

  if (query.cameras) {
    const cameras = query.cameras.split(',');
    notifications = notifications.filter(
      (notification) => cameras.includes(notification.camera) || cameras.includes(notification.title)
    );
  }

  if (query.labels) {
    const labels = query.labels.split(',');
    notifications = notifications.filter((notification) => labels.includes(notification.label));
  }

  if (query.rooms) {
    const rooms = query.rooms.split(',');
    notifications = notifications.filter((notification) => rooms.includes(notification.room));
  }

  if (query.types) {
    const types = query.types.split(',');
    notifications = notifications.filter(
      (notification) => types.includes(notification.recordType) || types.includes(notification.type)
    );
  }

  return notifications;
};

export const listByCameraName = async (name) => {
  let notifications = await Database.interfaceDB.chain.get('notifications').reverse().cloneDeep().value();

  if (notifications) {
    notifications = notifications.filter((not) => not.camera === name);
  }

  return notifications;
};

export const findById = async (id) => {
  const notification =
    (await Database.interfaceDB.chain.get('notifications').find({ id: id }).cloneDeep().value()) ||
    Database.notificationsDB.chain.get('notifications').find({ id: id }).cloneDeep().value();

  return notification;
};

export const findAlertById = async (id) => {
  const notification = await Notification.findById(id);

  var formattedNotification = notification.toObject();

  formattedNotification._id = notification._id;
  formattedNotification._id = notification.id;
  formattedNotification.message = JSON.parse(notification.message);
  formattedNotification.image = `http://192.168.0.150:8081/files/${notification.fileName}`;

  return formattedNotification;
};

export const createNotification = async (data) => {
  console.log(data.camera);
  const camera = await Database.interfaceDB.chain.get('cameras').find({ name: data.camera }).cloneDeep().value();
  const camerasSettings = await Database.interfaceDB.chain.get('settings').get('cameras').cloneDeep().value();

  if (!camera) {
    throw new Error('Can not assign notification to camera!');
  }

  const cameraSetting = camerasSettings.find((cameraSetting) => cameraSetting && cameraSetting.name === camera.name);

  const id = data.id || (await nanoid());
  const room = cameraSetting ? cameraSetting.room : 'Standard';
  const timestamp = data.timestamp || moment().unix();
  const time = moment.unix(timestamp).format('YYYY-MM-DD HH:mm:ss');

  const fileName =
    camera.name.replace(/\s+/g, '_') +
    '-' +
    id +
    '-' +
    timestamp +
    (data.trigger === 'motion' ? '_m' : data.trigger === 'doorbell' ? '_d' : '_c') +
    '_CUI';

  const extension = data.type === 'Video' ? 'mp4' : 'jpeg';
  const label = (data.label || 'no label').toString();

  const notification = {
    message: data.message,
    id: id,
    camera: camera.name,
    fileName: `${fileName}.${extension}`,
    name: fileName,
    extension: extension,
    recordStoring: data.storing,
    recordType: data.type,
    trigger: data.trigger,
    room: room,
    time: time,
    timestamp: timestamp,
    label: label,
  };

  const notify = {
    ...notification,
    title: camera.name,
    message: `${data.trigger} - ${time}`,
    subtxt: room,
    mediaSource: data.storing ? `/files/${fileName}.${extension}` : false,
    thumbnail: data.storing
      ? data.type === 'Video'
        ? `/files/${fileName}@2.jpeg`
        : `/files/${fileName}.${extension}`
      : false,
    count: true,
    isNotification: true,
  };

  const notificationSettings = await Database.interfaceDB.chain
    .get('settings')
    .get('notifications')
    .cloneDeep()
    .value();

  if (notificationSettings.active) {
    //Check notification size, if we exceed more than {100} notifications, remove the latest
    const notificationList = await Database.interfaceDB.chain.get('notifications').cloneDeep().value();

    if (notificationList.length > notificationsLimit) {
      const diff = notificationList.length - notificationsLimit;
      const diffNotifiations = notificationList.slice(-diff);

      for (const notification of diffNotifiations) {
        Cleartimer.removeNotificationTimer(notification.id);
      }

      await Database.interfaceDB.chain.get('notifications').dropRight(notificationList, diff).value();
    }

    await Database.interfaceDB.chain.get('notifications').push(notification).value();

    Cleartimer.setNotification(id, timestamp);
  }

  return {
    notification: notification,
    notify: notify,
  };
};

export const createCameraNotification = async (data) => {
  const camera = await Database.interfaceDB.chain.get('cameras').find({ name: data.camera }).cloneDeep().value();
  const camerasSettings = await Database.interfaceDB.chain.get('settings').get('cameras').cloneDeep().value();

  if (!camera) {
    throw new Error('Can not assign notification to camera!');
  }

  const id = data.id || (await nanoid());
  const room = data.site;
  const timestamp = data.timestamp || moment().unix();
  const time = data.time;

  const fileName = camera.name.replace(/\s+/g, '_') + '-' + id + '-' + timestamp + '_buzz' + '_CUI';

  const extension = 'jpg';
  const label = `${data.alertType}-${data.severity}`;

  var storedFile = `/var/lib/homebridge/camera.ui/recordings/${fileName}.${extension}`;
  const jpegBuffer = Buffer.from(data.image, 'base64');

  fs.writeFile(storedFile, jpegBuffer, (error) => {
    if (error) {
      console.error('Error saving JPEG:', error);
    } else {
      console.log('JPEG saved successfully!');
    }
  });

  const notification = new Notification({
    message: JSON.stringify(data.object),
    id: id,
    camera: camera.name,
    fileName: `${fileName}.${extension}`,
    name: fileName,
    extension: extension,
    recordStoring: data.storing,
    recordType: data.alertType,
    trigger: data.alertType,
    room: room,
    time: time,
    timestamp: timestamp,
    label: label,
  });

  // const notify = {
  //   ...notification,
  //   title: camera.name,
  //   message: `${data.trigger} - ${time}`,
  //   subtxt: room,
  //   mediaSource: data.storing ? `/files/${fileName}.${extension}` : false,
  //   thumbnail: data.storing
  //     ? data.type === 'Video'
  //       ? `/files/${fileName}@2.jpeg`
  //       : `/files/${fileName}.${extension}`
  //     : false,
  //   count: true,
  //   isNotification: true,
  // };

  // const notificationSettings = await Database.interfaceDB.chain
  //   .get('settings')
  //   .get('notifications')
  //   .cloneDeep()
  //   .value();

  const createdDocument = await Notification.create(notification);

  var formattedNotification = notification.toObject();

  formattedNotification._id = createdDocument._id;
  formattedNotification.message = JSON.parse(notification.message);
  formattedNotification.image = `http://192.168.0.150:8081/files/${fileName}`;

  return formattedNotification;
};

export const removeById = async (id) => {
  Cleartimer.removeNotificationTimer(id);

  Database.notificationsDB.chain
    .get('notifications')
    .remove((not) => not.id === id)
    .value();

  return await Database.interfaceDB.chain
    .get('notifications')
    .remove((not) => not.id === id)
    .value();
};

export const removeAll = async () => {
  Cleartimer.stopNotifications();

  Database.notificationsDB.chain
    .get('notifications')
    .remove(() => true)
    .value();

  return await Database.interfaceDB.chain
    .get('notifications')
    .remove(() => true)
    .value();
};
