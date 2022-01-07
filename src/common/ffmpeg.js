'use-strict';

const fs = require('fs-extra');
const piexif = require('piexifjs');
const { spawn } = require('child_process');

const cameraUtils = require('../controller/camera/utils/camera.utils');

const { ConfigService } = require('../services/config/config.service');
const { LoggerService } = require('../services/logger/logger.service');

const { CameraController } = require('../controller/camera/camera.controller');

const { log } = LoggerService;

const replaceJpegWithExifJPEG = function (cameraName, filePath, label) {
  let jpeg;

  try {
    jpeg = fs.readFileSync(filePath);
  } catch {
    log.debug(`Can not read file ${filePath} to create EXIF information, skipping..`);
  }

  if (!jpeg) {
    return;
  }

  const zeroth = {};
  const data = jpeg.toString('binary');

  zeroth[piexif.ImageIFD.XPTitle] = [...Buffer.from(cameraName, 'ucs2')];
  zeroth[piexif.ImageIFD.XPComment] = [...Buffer.from(label, 'ucs2')];
  zeroth[piexif.ImageIFD.XPAuthor] = [...Buffer.from('camera.ui', 'ucs2')];

  const exifObject = { '0th': zeroth, Exif: {}, GPS: {} };
  const exifbytes = piexif.dump(exifObject);

  var newData = piexif.insert(exifbytes, data);
  var newJpeg = Buffer.from(newData, 'binary');

  fs.writeFileSync(filePath, newJpeg);
};

const storeFrameFromVideoBuffer = function (camera, fileBuffer, outputPath) {
  return new Promise((resolve, reject) => {
    const videoProcessor = ConfigService.ui.options.videoProcessor;

    const videoWidth = camera.videoConfig.maxWidth || 1280;
    const videoHeight = camera.videoConfig.maxHeight || 720;

    const ffmpegArguments = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-an',
      '-sn',
      '-dn',
      '-y',
      '-re',
      '-i',
      '-',
      '-s',
      `${videoWidth}x${videoHeight}`,
      '-f',
      'image2',
      '-update',
      '1',
    ];

    ffmpegArguments.push(outputPath);

    log.debug(`Snapshot command: ${videoProcessor} ${ffmpegArguments.join(' ')}`, camera.name);

    const ffmpeg = spawn(videoProcessor, ffmpegArguments, { env: process.env });

    const errors = [];

    ffmpeg.stderr.on('data', (data) => errors.push(data.toString().replace(/(\r\n|\n|\r)/gm, '')));

    ffmpeg.on('error', (error) => reject(error));

    ffmpeg.on('exit', (code, signal) => {
      if (code === 1) {
        errors.unshift(`FFmpeg snapshot process exited with error! (${signal})`);
        reject(new Error(errors.join(' - ')));
      } else {
        log.debug('FFmpeg snapshot process exited (expected)', camera.name, 'ffmpeg');
        log.debug(`Snapshot stored to: ${outputPath}`, camera.name);

        resolve();
      }

      return;
    });

    ffmpeg.stdin.write(fileBuffer);
    ffmpeg.stdin.destroy();
  });
};

exports.storeBuffer = async function (
  camera,
  fileBuffer,
  recordingPath,
  fileName,
  label,
  isPlaceholder,
  externRecording
) {
  let outputPath = `${recordingPath}/${fileName}${isPlaceholder ? '@2' : ''}.jpeg`;

  // eslint-disable-next-line unicorn/prefer-ternary
  if (externRecording) {
    await storeFrameFromVideoBuffer(camera, fileBuffer, outputPath);
  } else {
    await fs.outputFile(outputPath, fileBuffer, { encoding: 'base64' });
  }

  replaceJpegWithExifJPEG(camera.name, outputPath, label);
};

exports.getAndStoreSnapshot = function (camera, recordingPath, fileName, label, isPlaceholder, storeSnapshot) {
  return new Promise((resolve, reject) => {
    const videoProcessor = ConfigService.ui.options.videoProcessor;

    const ffmpegInput = [...cameraUtils.generateInputSource(camera.videoConfig).split(/\s+/)];
    const videoWidth = camera.videoConfig.maxWidth || 1280;
    const videoHeight = camera.videoConfig.maxHeight || 720;

    const destination = storeSnapshot ? `${recordingPath}/${fileName}${isPlaceholder ? '@2' : ''}.jpeg` : '-';

    const ffmpegArguments = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      ...ffmpegInput,
      '-s',
      `${videoWidth}x${videoHeight}`,
      '-frames:v',
      '2',
      '-r',
      '1',
      '-update',
      '1',
      '-f',
      'image2',
    ];

    if (camera.videoConfig.videoFilter) {
      ffmpegArguments.push('-filter:v', camera.videoConfig.videoFilter);
    }

    ffmpegArguments.push(destination);

    log.debug(`Snapshot requested, command: ${videoProcessor} ${ffmpegArguments.join(' ')}`, camera.name);

    const ffmpeg = spawn(videoProcessor, ffmpegArguments, { env: process.env });

    const errors = [];

    ffmpeg.stderr.on('data', (data) => errors.push(data.toString().replace(/(\r\n|\n|\r)/gm, '')));

    let imageBuffer = Buffer.alloc(0);

    ffmpeg.stdout.on('data', (data) => {
      imageBuffer = Buffer.concat([imageBuffer, data]);

      if (storeSnapshot) {
        log.debug(data.toString(), camera.name);
      }
    });

    ffmpeg.on('error', (error) => reject(error));

    ffmpeg.on('exit', (code, signal) => {
      if (code === 1) {
        errors.unshift(`FFmpeg snapshot process exited with error! (${signal})`);
        reject(new Error(errors.join(' - ')));
      } else if (!imageBuffer || (imageBuffer && imageBuffer.length <= 0)) {
        errors.unshift('Image Buffer is empty!');
        reject(new Error(errors.join(' - ')));
      } else {
        log.debug('FFmpeg snapshot process exited (expected)', camera.name, 'ffmpeg');

        if (storeSnapshot) {
          replaceJpegWithExifJPEG(camera.name, destination, label);
        }

        resolve(imageBuffer);
      }
    });
  });
};

exports.storeSnapshotFromVideo = async function (camera, recordingPath, fileName) {
  return new Promise((resolve, reject) => {
    const videoProcessor = ConfigService.ui.options.videoProcessor;
    const videoName = `${recordingPath}/${fileName}.mp4`;
    const destination = `${recordingPath}/${fileName}@2.jpeg`;

    const ffmpegArguments = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      '00:00:03.500',
      '-i',
      videoName,
      '-frames:v',
      '1',
    ];

    ffmpegArguments.push(destination);

    log.debug(`Snapshot requested, command: ${videoProcessor} ${ffmpegArguments.join(' ')}`, camera.name);

    const ffmpeg = spawn(videoProcessor, ffmpegArguments, { env: process.env });

    const errors = [];

    ffmpeg.stderr.on('data', (data) => errors.push(data.toString().replace(/(\r\n|\n|\r)/gm, '')));

    ffmpeg.on('error', (error) => reject(error));

    ffmpeg.on('exit', (code, signal) => {
      if (code === 1) {
        errors.unshift(`FFmpeg snapshot process exited with error! (${signal})`);
        reject(new Error(errors.join(' - ')));
      } else {
        log.debug('FFmpeg snapshot process exited (expected)', camera.name, 'ffmpeg');
        resolve();
      }
    });
  });
};

// eslint-disable-next-line no-unused-vars
exports.storeVideo = function (camera, recordingPath, fileName, recordingTimer) {
  return new Promise((resolve, reject) => {
    const videoProcessor = ConfigService.ui.options.videoProcessor;
    const ffmpegInput = [...cameraUtils.generateInputSource(camera.videoConfig).split(/\s+/)];
    const videoName = `${recordingPath}/${fileName}.mp4`;
    const videoWidth = camera.videoConfig.maxWidth || 1280;
    const videoHeight = camera.videoConfig.maxHeight || 720;
    const vcodec = camera.videoConfig.vcodec || 'libx264';

    const ffmpegArguments = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-y',
      ...ffmpegInput,
      '-t',
      recordingTimer.toString(),
      '-strict',
      'experimental',
      '-threads',
      '0',
      '-s',
      `${videoWidth}x${videoHeight}`,
      '-vcodec',
      `${vcodec}`,
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-crf',
      '23',
    ];

    if (camera.videoConfig.mapvideo) {
      ffmpegArguments.push('-map', camera.videoConfig.mapvideo);
    }

    if (camera.videoConfig.videoFilter) {
      ffmpegArguments.push('-filter:v', camera.videoConfig.videoFilter);
    }

    if (camera.videoConfig.mapaudio) {
      ffmpegArguments.push('-map', camera.videoConfig.mapaudio);
    }

    ffmpegArguments.push(videoName);

    log.debug(`Video requested, command: ${videoProcessor} ${ffmpegArguments.join(' ')}`, camera.name);

    const ffmpeg = spawn(videoProcessor, ffmpegArguments, { env: process.env });

    const errors = [];

    ffmpeg.stderr.on('data', (data) => errors.push(data.toString().replace(/(\r\n|\n|\r)/gm, '')));

    ffmpeg.on('error', (error) => reject(error));

    ffmpeg.on('exit', (code, signal) => {
      if (code === 1) {
        errors.unshift(`FFmpeg video process exited with error! (${signal})`);
        reject(new Error(errors.join(' - ')));
      } else {
        log.debug('FFmpeg video process exited (expected)', camera.name, 'ffmpeg');
        log.debug(`Video stored to: ${videoName}`, camera.name);

        resolve();
      }
    });
  });
};

exports.storeVideoBuffer = function (camera, fileBuffer, recordingPath, fileName) {
  return new Promise((resolve, reject) => {
    const videoName = `${recordingPath}/${fileName}.mp4`;

    log.debug(`Storing video to: ${videoName}`, camera.name);

    const writeStream = fs.createWriteStream(videoName);

    writeStream.write(fileBuffer);
    writeStream.end();

    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });
};

exports.handleFragmentsRequests = async function* (camera) {
  log.debug('Video fragments requested from interface', camera.name);

  const audioArguments = ['-acodec', 'copy'];
  const videoArguments = ['-vcodec', 'copy'];

  let ffmpegInput = [...cameraUtils.generateInputSource(camera.videoConfig).split(/\s+/)];
  const controller = CameraController.cameras.get(camera.name);

  if (camera.prebuffering && controller?.prebuffer) {
    try {
      log.debug('Setting prebuffer stream as input', camera.name);

      const input = await controller.prebuffer.getVideo({
        container: 'mp4',
        prebuffer: camera.prebufferLength,
      });

      ffmpegInput = [];
      ffmpegInput.push(...input);
    } catch (error) {
      log.warn(`Can not access prebuffer stream, skipping: ${error}`, camera.name, 'ffmpeg');
    }
  }

  const session = await cameraUtils.startFFMPegFragmetedMP4Session(
    camera.name,
    camera.videoConfig.debug,
    ConfigService.ui.options.videoProcessor,
    ffmpegInput,
    audioArguments,
    videoArguments
  );

  log.debug('Recording started', camera.name);

  const { socket, cp, generator } = session;
  let pending = [];

  try {
    for await (const box of generator) {
      const { header, type, data } = box;

      pending.push(header, data);

      if (type === 'moov' || type === 'mdat') {
        const fileBuffer = pending;
        pending = [];

        yield fileBuffer;
      }
    }
  } catch {
    log.debug('Recording completed. (UI)', camera.name);
  } finally {
    socket.destroy();
    cp.kill();
  }
};
