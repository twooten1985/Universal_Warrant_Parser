/**
 * Synthetic Google return. No real names, emails, or paths.
 * example.test addresses and documentation IP ranges only.
 */
import type { UploadedFile } from '../types';

const A = 'synthetic.user@example.test';
const A_ID = '100000001001';
const B = 'synthetic.other@example.test';
const B_ID = '100000002002';

const TINY_MP3 = 'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYwLjE2LjEwMAAAAAAAAAAAAAAA/+M4wAAAAAAAAAAAAEluZm8AAAAPAAAABQAAAkAAgICAgICAgICAgICAgICAgICAgKCgoKCgoKCgoKCgoKCgoKCgoKCgwMDAwMDAwMDAwMDAwMDAwMDAwMDg4ODg4ODg4ODg4ODg4ODg4ODg4P//////////////////////////AAAAAExhdmM2MC4zMQAAAAAAAAAAAAAAACQCwAAAAAAAAAJAvfdF8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+MYxAAAAANIAAAAAExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVV/+MYxDsAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV/+MYxHYAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV/+MYxLEAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV/+MYxMQAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV';
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVQI12P4z8AAAAADAAEABf4C/gAAAABJRU5ErkJggg==';

function folder(email: string, id: string, product: string, category: string, part = '001', preserved = false): string {
  return `${email}.${id}.${product}.${category}_${part}${preserved ? '.Preserved' : ''}`;
}

function textFile(dir: string, name: string, content: string): UploadedFile {
  return {
    name,
    relativePath: `${dir}/${name}`,
    content,
    size: content.length,
    isMedia: false,
    provider: 'google',
  };
}

/** Files mixed into the Google demo and reused by the category tests. */
export function googleCategorySample(): UploadedFile[] {
  const activity = folder(A, A_ID, 'AccessLogActivity', 'Activity');
  const activityEmpty = folder(B, B_ID, 'AccessLogActivity', 'Activity');
  const devices = folder(A, A_ID, 'AccessLogActivity', 'Devices');
  const changes = folder(A, A_ID, 'GoogleAccount', 'ChangeHistory');
  const subscriber = folder(A, A_ID, 'GoogleAccount', 'SubscriberInfo');
  const linked = folder(A, A_ID, 'GoogleAccountTargetAssociation', 'LinkedByAndroidProfile');
  const android = folder(A, '900000111222', 'AndroidDeviceConfigurationService', 'DeviceAndUserProfile');
  const myActivity = folder(A, A_ID, 'MyActivity', 'MyActivity');
  const contacts = folder(A, A_ID, 'Contacts', 'Contacts');
  const voice = folder(A, A_ID, 'Voice', 'Communications');
  const records = folder(A, A_ID, 'Timeline', 'Records');
  const semantic = folder(A, A_ID, 'Timeline', 'SemanticLocationHistory');
  const settings = folder(A, A_ID, 'Timeline', 'Settings');
  const places = folder(A, A_ID, 'Timeline', 'UserLocationProfile');
  const encrypted = folder(A, A_ID, 'Timeline', 'EncryptedBackups');
  const chat = folder(A, A_ID, 'GoogleChat', 'Messages');
  const fi = folder(A, A_ID, 'GoogleFiWireless', 'UserInfo');
  const pay = folder(A, A_ID, 'GooglePay', 'ConsumerTransactions');
  const unknown = folder(A, A_ID, 'FutureProduct', 'UnmappedExport');
  const photos = folder(A, A_ID, 'GooglePhotos', 'PhotoResourceLegal');
  const extraPhotos: UploadedFile[] = [];
  for (let i = 0; i < 81; i++) {
    extraPhotos.push({
      name: `photo-${String(i).padStart(3, '0')}.jpg`,
      relativePath: `${photos}/photo-${String(i).padStart(3, '0')}.jpg`,
      content: TINY_PNG,
      size: 70,
      isMedia: true,
      mediaType: 'image',
      ...(i === 0 ? {} : { provider: (i === 1 ? 'snapchat' : 'google') as UploadedFile['provider'] }),
    });
  }
  const meet = folder(B, B_ID, 'GoogleMeet', 'MeetingHistory');
  const preserved = folder(A, A_ID, 'Mail', 'MessageInformation', '001', true);

  return [
    textFile(activity, 'Activity.csv', [
      'Timestamp,IP Address,Proxied Host IP,Country,Region,City,User Agent,Product,Sub-Product,Activity Type,Gmail Access Channel,GAIA ID',
      '2024-05-01T15:04:05Z,203.0.113.10,198.51.100.20,Exampleland,Example Region,Example City,SyntheticBrowser/1.0,Gmail,Web,Login,Web,100000001001',
      '2024-05-01T16:00:00Z,2001:db8::10,,Exampleland,Example Region,Example City,SyntheticBrowser/1.0,Maps,App,Search,,100000001001',
      '2024-05-02T00:00:00Z,172.16.5.5,,Exampleland,Example Region,Example City,SyntheticBrowser/1.0,Accounts,Web,Login,,100000001001',
    ].join('\n')),
    textFile(activity, 'Activity-source-ip.csv', [
      'Time (UTC),Source IP,Product',
      '2024-06-02T09:00:00Z,198.51.100.60,Gmail',
    ].join('\n')),
    textFile(activity, 'Activity-alt.csv', [
      'Google Account Data',
      'Service: Access Log Activity',
      'Originating Identifier: synthetic.user@example.test',
      'Resolved Identifier: 100000001001',
      '',
      'Activity Timestamp,Activity IP Address,Activity Type',
      '2024-06-01 08:00:00 UTC,203.0.113.60,Login',
      ',203.0.113.61,Login',
    ].join('\n')),
    textFile(activity, 'note.txt', 'Router note 203.0.113.90 was recorded with no column.\n'),
    textFile(activityEmpty, 'NoData.txt', [
      'Google Account Data',
      'Service: Access Log Activity',
      'Originating Identifier: synthetic.other@example.test',
      'Resolved Identifier: 100000002002',
      'No Data',
    ].join('\n')),
    textFile(devices, 'Devices.csv', [
      'First Activity,Last Activity,Device Type,Brand,Model,OS,OS Version,Last Country,IP Address',
      '2024-01-01T00:00:00Z,2024-05-01T15:00:00Z,Phone,Synthetic,Handset,Android,14,Exampleland,203.0.113.50',
    ].join('\n')),
    textFile(changes, 'ChangeHistory.html', [
      '<html><body><table>',
      '<tr><th>Time</th><th>Change</th><th>IP</th></tr>',
      '<tr><td>2024-04-01T12:00:00Z</td><td>Recovery email</td><td>203.0.113.44</td></tr>',
      '<tr><td></td><td>Password</td><td>198.51.100.8</td></tr>',
      '<tr><td>2024-04-02T01:00:00Z</td><td>2-step</td><td>2001:db8::44</td></tr>',
      '</table></body></html>',
    ].join('')),
    textFile(linked, 'LinkedByAndroidProfile.csv', [
      'Linked email,Profile id,Linked on',
      'linked.peer@example.test,profile-100,2023-01-15T00:00:00Z',
    ].join('\n')),
    textFile(subscriber, 'SubscriberInfo.html', [
      '<html><head><script>alert("nope")</script></head><body>',
      '<p>Google Account Data</p>',
      '<p>Service: Google Account</p>',
      '<p>Email Address Associated with Google Account ID: synthetic.user@example.test</p>',
      '<p>Resolved Identifier: 100000001001</p>',
      '<p>Created: 2020-01-02</p>',
      '<p>Sign-up IP: 203.0.113.77</p>',
      '</body></html>',
    ].join('')),
    textFile(android, 'Device-1.html', '<html><body><p>Device model: Synthetic Handset</p><p>OS: Android 14</p></body></html>'),
    textFile(android, 'Network.html', '<html><body><p>Device model: Synthetic Handset Two</p><p>Wi-Fi only</p></body></html>'),
    textFile(myActivity, 'MyActivity.html', [
      '<div class="outer-cell"><div class="header-cell">Search</div>',
      '<div class="content-cell">Searched for <a href="https://example.test/q">synthetic query</a><br>2024-05-03T18:30:00Z</div></div>',
    ].join('')),
    textFile(contacts, 'contacts.vcf', [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Synthetic Contact',
      'TEL:+15555550100',
      'EMAIL:contact@example.test',
      'END:VCARD',
    ].join('\n')),
    textFile(voice, 'calls.html', [
      '<div class="hChatLog message">',
      '<abbr class="dt" title="2024-05-04T13:00:00Z">May 4</abbr>',
      '<cite class="sender"><span class="fn">Synthetic Peer</span>',
      '<a class="tel" href="tel:+15555550199">+15555550199</a></cite>',
      '<q>synthetic voice text</q>',
      '<a href="voicemail.mp3">voicemail</a>',
      '</div>',
    ].join('')),
    {
      name: 'voicemail.mp3',
      relativePath: `${voice}/voicemail.mp3`,
      content: TINY_MP3,
      size: 621,
      isMedia: false,
      provider: 'google',
    },
    textFile(records, 'Records.json', JSON.stringify({
      locations: [{
        timestamp: '2024-05-01T15:00:00.000Z',
        latitudeE7: 377749000,
        longitudeE7: -1224194000,
        accuracy: 20,
        deviceTag: '1',
      }],
    })),
    textFile(records, 'RawSignals.json', JSON.stringify({
      rawSignals: [{
        position: { latLng: '37.7800°, -122.4100°', accuracyMeters: 15, timestamp: '2024-05-01T18:00:00Z' },
        source: 'WIFI',
      }],
    })),
    textFile(semantic, 'Semantic.json', JSON.stringify({
      semanticSegments: [
        { startTime: '2024-05-01T16:00:00Z', visit: { topCandidate: { placeLocation: 'geo:37.7700,-122.4200' } } },
        { startTime: '2024-05-01T17:00:00Z', activity: { activityType: 'WALKING', start: { latLng: '37.7700°, -122.4200°' }, end: { latLng: '37.7900°, -122.4000°' } } },
      ],
    })),
    textFile(settings, 'Settings.json', JSON.stringify({
      deviceSettings: [{ deviceTag: '1', devicePrettyName: 'Synthetic Handset', platformType: 'ANDROID', reportingEnabled: true }],
    })),
    textFile(places, 'UserLocationProfile.json', JSON.stringify({
      frequentPlaces: [{ label: 'HOME', placeId: 'synthetic-home', placeLocation: 'geo:37.7600,-122.4300' }],
    })),
    textFile(encrypted, 'Encrypted Backups.txt', 'Encrypted Backups\nThis backup is encrypted by Google and cannot be read.'),
    textFile(chat, 'messages.json', JSON.stringify({
      messages: [{
        created_date: '2024-05-02T12:00:00Z',
        creator: { name: 'Synthetic Peer', email: 'peer@example.test', user_type: 'Human' },
        text: 'synthetic chat line',
        attached_files: [{ export_name: 'note.txt' }],
      }],
    })),
    textFile(fi, 'GoogleFi.UserInfo.Records.txt', [
      'Start\tEnd\tUser number\tUsage type\tDirection\tDuration\tRemote number\tEquipment ID\tCarrier\tWifi\tVoicemail',
      '2024-05-06T10:00:00Z\t2024-05-06T10:02:00Z\t+15555550123\tCall\toutbound\t120\t+15555550999\tequip-1\tExample Wireless\tfalse\tfalse',
    ].join('\n')),
    textFile(pay, 'transactions.csv', [
      'timestamp,transaction id,description,product,payment method,status,amount',
      '2024-05-07T09:00:00Z,txn-1,synthetic purchase,Pay,Card,Completed,12.00',
    ].join('\n')),
    textFile(unknown, 'export.csv', [
      'Alpha,Beta,When',
      'one,two,2024-05-08T00:00:00Z',
    ].join('\n')),
    textFile(photos, 'photo.jpg.json', JSON.stringify({
      title: 'synthetic.jpg',
      photoTakenTime: { timestamp: '1714521600' },
      geoData: { latitude: 37.75, longitude: -122.44 },
    })),
    {
      name: 'synthetic.jpg',
      relativePath: `${photos}/synthetic.jpg`,
      content: TINY_PNG,
      size: 70,
      isMedia: true,
      mediaType: 'image',
      provider: 'google',
    },
    ...extraPhotos,
    textFile(meet, 'MeetingHistory.csv', [
      'Meeting code,Start,Participant count',
      'abc-defg-hij,2024-05-09T15:00:00Z,2',
    ].join('\n')),
    textFile(preserved, 'MessageInformation.csv', [
      'Date,From,To,Subject',
      '2024-05-10T11:00:00Z,synthetic.user@example.test,peer@example.test,synthetic subject',
    ].join('\n')),
    {
      name: `${android}.zip`,
      relativePath: `${android}.zip`,
      content: '',
      size: 128,
      isMedia: false,
      provider: 'google',
    },
    {
      name: `${subscriber}.zip`,
      relativePath: `${subscriber}.zip`,
      content: '',
      size: 256,
      isMedia: false,
      provider: 'google',
    },
  ];
}
