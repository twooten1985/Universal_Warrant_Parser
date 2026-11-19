/**
 * Plain-English descriptions of Google warrant-return categories.
 * Edit this table when a format is confirmed. Descriptions stay conservative:
 * a field is named only when a warrant return or a cited public format has shown it.
 * "Guessed" categories say so and fall back to the generic viewer.
 */

export type GoogleFeed = 'timeline' | 'ip-map' | 'messages' | 'gmail' | 'locations' | 'media' | 'generic';

/** parsed = records land in an existing view; generic = table/tree/text; flagged = not viewable. */
export type GoogleCategoryMode = 'parsed' | 'generic' | 'flagged';

export interface GoogleCategoryDef {
  /** "Product.Category" */
  id: string;
  product: string;
  category: string;
  label: string;
  group: string;
  /** What the data is, what an examiner typically gets, and whether it is usually worth opening. */
  description: string;
  parser: string;
  feeds: GoogleFeed[];
  mode: GoogleCategoryMode;
}

export interface GoogleProductDef {
  id: string;
  label: string;
  description: string;
}

export const GOOGLE_PRODUCTS: Record<string, GoogleProductDef> = {
  AccessLogActivity: {
    id: 'AccessLogActivity',
    label: 'Access log',
    description: 'Sign-in and product-activity logs for the account. Examiners use these for when the account was used, from which IP, and with which client. The detailed Activity file is usually worth opening first. Device and aggregated files add context when they contain rows.',
  },
  Contacts: {
    id: 'Contacts',
    label: 'Contacts',
    description: 'The account address book, usually vCard files. Worth opening for names, phone numbers, and emails tied to the account.',
  },
  Drive: {
    id: 'Drive',
    label: 'Drive',
    description: 'Google Drive files and a metadata sheet when Google produced one. File names, times, and owners are the usual lead. File contents are whatever was actually produced and are opened as the original file.',
  },
  DriveAssociatedTargets: {
    id: 'DriveAssociatedTargets',
    label: 'Shared drives',
    description: 'Shared-drive (Team Drive) metadata for drives this account is associated with. Worth a look for drive names and membership when rows are present. The column layout is not a confirmed warrant schema, so rows are shown from the header.',
  },
  DriveMobileBackups: {
    id: 'DriveMobileBackups',
    label: 'Drive mobile backups',
    description: 'Mobile-device backups stored in Drive. These are treated as binary: the app lists and can hash them, and does not try to decode the backup.',
  },
  GoogleAccount: {
    id: 'GoogleAccount',
    label: 'Google Account',
    description: 'Subscriber identity and account-change history. Subscriber info is the account\'s name, email, and GAIA id. Change history is time and IP rows for changes Google recorded. Both are usually worth opening.',
  },
  GoogleAccountTargetAssociation: {
    id: 'GoogleAccountTargetAssociation',
    label: 'Linked accounts',
    description: 'Other identifiers Google tied to this account (phone, cookies, or an Android profile, depending on the folder). Worth opening when rows are present. Several sibling files are CSV in public parser notes; this build reads them from the header rather than assuming one layout.',
  },
  AndroidDeviceConfigurationService: {
    id: 'AndroidDeviceConfigurationService',
    label: 'Android device profile',
    description: 'An HTML device and user profile. The number in this folder name is often an Android device id, not the account GAIA id. Worth opening for the device description Google wrote. The account is taken from the email in the folder name when one is present.',
  },
  GoogleChat: {
    id: 'GoogleChat',
    label: 'Google Chat',
    description: 'Chat messages, room membership, and chat profile. Messages are the part usually worth opening. Group tasks have no confirmed warrant layout and open in the generic viewer.',
  },
  GoogleFiWireless: {
    id: 'GoogleFiWireless',
    label: 'Google Fi',
    description: 'Google Fi subscriber, usage, billing, messages, and voicemail. The usage record (UserInfo) is a tab-separated call and message log and is usually worth opening. Billing and other Fi files are shown from their headers because a warrant layout was not confirmed.',
  },
  GoogleMeet: {
    id: 'GoogleMeet',
    label: 'Google Meet',
    description: 'Meet conference, participant, session, history, and media files. A warrant column layout was not confirmed, so each file is read from its header into a table. Worth opening when the return actually contains rows.',
  },
  GooglePay: {
    id: 'GooglePay',
    label: 'Google Pay',
    description: 'Payments, peer transfers, transit, wallet, and valuables. Consumer transaction exports are often a CSV with time, description, status, and amount. Other Pay folders are shown from their headers. Worth opening when transactions were produced.',
  },
  GooglePhotos: {
    id: 'GooglePhotos',
    label: 'Google Photos',
    description: 'Photo files plus JSON sidecars. When a sidecar has a capture time or geoData coordinates, those feed Media and the map. Print orders have no confirmed layout and open as a table. Photos are usually worth opening.',
  },
  Mail: {
    id: 'Mail',
    label: 'Gmail',
    description: 'Mailbox contents (mbox), message-header sheets, and mail settings. Full messages open in the Gmail browser. MessageInformation is headers rather than bodies when that is all Google produced. Settings are usually low value.',
  },
  Maps: {
    id: 'Maps',
    label: 'Maps',
    description: 'Aliased or labeled places. A public Maps export uses GeoJSON features with a name and address. Coordinates, when present, are plotted. Worth opening for places the account saved or labeled.',
  },
  MyActivity: {
    id: 'MyActivity',
    label: 'My Activity',
    description: 'Search, YouTube, and other product activity Google saved. Warrant returns are often HTML; a JSON export uses title, URL, time, and product fields. Usually worth opening for what was searched or watched and when.',
  },
  Saved: {
    id: 'Saved',
    label: 'Saved',
    description: 'Saved places and collections. A public export is a CSV of titles, notes, URLs, and tags. Worth opening for places the account saved. A warrant column layout was not separately confirmed.',
  },
  Timeline: {
    id: 'Timeline',
    label: 'Timeline / Location History',
    description: 'Location History: points, visits, trips, device names, edits, and home/work labels. Records and semantic history are usually the most useful location files. Settings maps a device tag to a device name. Encrypted backups cannot be read. Edits and tombstones open as a table because their schema was not confirmed.',
  },
  Voice: {
    id: 'Voice',
    label: 'Google Voice',
    description: 'Voice texts, calls, voicemail audio, the Voice address book, billing, and subscriber information. Communications HTML is usually worth opening. Billing and subscriber pages are shown from the text Google wrote; a fixed column layout was not confirmed.',
  },
};

function cat(
  product: string,
  category: string,
  label: string,
  description: string,
  parser: string,
  feeds: GoogleFeed[],
  mode: GoogleCategoryMode,
): GoogleCategoryDef {
  return {
    id: `${product}.${category}`,
    product,
    category,
    label,
    group: GOOGLE_PRODUCTS[product]?.label || product,
    description,
    parser,
    feeds,
    mode,
  };
}

/** Kept as text so a minified build still shows this table was packaged. */
export const GOOGLE_CATEGORY_TABLE = 'googleCategories GOOGLE_CATEGORIES';

export const GOOGLE_CATEGORIES: Record<string, GoogleCategoryDef> = {
  'AccessLogActivity.Activity': cat(
    'AccessLogActivity', 'Activity', 'Activity',
    'Sign-in and product activity. Warrant CSV columns vary by return. Public parser notes list time, IP address, a proxied host IP, country/region/city, user agent, product, sub-product, activity type, Gmail access channel, and GAIA id. Useful for attribution and for IP subpoenas. Usually worth opening.',
    'access-log-activity', ['timeline', 'ip-map'], 'parsed',
  ),
  'AccessLogActivity.Devices': cat(
    'AccessLogActivity', 'Devices', 'Devices',
    'Devices that used the account. A public device export lists first and last activity, device type, brand, model, OS, OS version, and last country. The warrant file is read from those headers when they are present. Worth opening for device names.',
    'access-log-devices', ['timeline'], 'parsed',
  ),
  'AccessLogActivity.AggregatedActivities': cat(
    'AccessLogActivity', 'AggregatedActivities', 'Aggregated activity',
    'Rolled-up activity counts. A warrant column layout was not confirmed, so rows are shown from the file header. Worth a look after the detailed Activity file. Do not treat a column as a specific fact unless its header says so.',
    'header-table', ['generic'], 'generic',
  ),
  'Contacts.Contacts': cat(
    'Contacts', 'Contacts', 'Contacts',
    'Address-book contacts as vCard (.vcf). Names, phone numbers, and emails are read from the cards. Worth opening.',
    'vcf', ['generic'], 'parsed',
  ),
  'Drive.DriveFiles': cat(
    'Drive', 'DriveFiles', 'Drive files',
    'Drive file metadata and any original files Google produced. Metadata sheets are read from their headers (name, type, times, owner, hash) when those headers exist. Originals stay in the workspace. Worth opening for file names and dates.',
    'header-table', ['generic'], 'generic',
  ),
  'DriveAssociatedTargets.SharedDrives': cat(
    'DriveAssociatedTargets', 'SharedDrives', 'Shared drives',
    'Shared-drive (also called Team Drive) metadata. The column layout is not confirmed, so the sheet is shown from its header. Worth a look for drive names and members when rows exist.',
    'header-table', ['generic'], 'generic',
  ),
  'DriveMobileBackups.Backup': cat(
    'DriveMobileBackups', 'Backup', 'Mobile backup',
    'A Drive mobile backup. Treated as binary: listed and available to hash, not decoded. Not viewable as records.',
    'list-only', ['generic'], 'flagged',
  ),
  'GoogleAccount.ChangeHistory': cat(
    'GoogleAccount', 'ChangeHistory', 'Change history',
    'Account changes Google recorded. Warrant returns are HTML. This build reads table rows and keeps a time and an IP only when that row actually contains them. Column titles differ by return, so they are not assumed. Usually worth opening.',
    'change-history-html', ['timeline', 'ip-map'], 'parsed',
  ),
  'GoogleAccount.SubscriberInfo': cat(
    'GoogleAccount', 'SubscriberInfo', 'Subscriber info',
    'The account identity: email, GAIA id, and the subscriber page Google produced (HTML or JSON). Usually worth opening. This is the record the account filter should follow.',
    'subscriber', ['timeline'], 'parsed',
  ),
  'GoogleAccountTargetAssociation.LinkedByAndroidProfile': cat(
    'GoogleAccountTargetAssociation', 'LinkedByAndroidProfile', 'Linked by Android profile',
    'Accounts or identifiers Google linked through an Android profile. Sibling files (linked by phone, linked by cookies) are CSV in public parser notes. This build reads whatever header the file has and does not assume a column. Worth opening when rows are present.',
    'linked-accounts', ['generic'], 'parsed',
  ),
  'AndroidDeviceConfigurationService.DeviceAndUserProfile': cat(
    'AndroidDeviceConfigurationService', 'DeviceAndUserProfile', 'Device and user profile',
    'HTML device profile (files are often named Device-*.html). The number in the folder is often the Android device id, not the GAIA id. Worth opening for the device text Google produced.',
    'android-device-html', ['generic'], 'parsed',
  ),
  'GoogleChat.Messages': cat(
    'GoogleChat', 'Messages', 'Messages',
    'Google Chat messages. A public export is messages.json with a created date, creator name and email, text, and attachment export names. Those fields are read when present. Opens in the conversation view. Usually worth opening.',
    'chat-messages', ['messages', 'timeline'], 'parsed',
  ),
  'GoogleChat.GroupInfo': cat(
    'GoogleChat', 'GroupInfo', 'Room members',
    'Chat room membership. A public export lists members with a name and email. Worth opening alongside the messages.',
    'chat-group', ['messages'], 'parsed',
  ),
  'GoogleChat.UserInfo': cat(
    'GoogleChat', 'UserInfo', 'Chat profile',
    'The Google Chat user profile (email, state, created date when those fields are present). Worth a look with the messages. It does not replace Subscriber info.',
    'chat-user', ['generic'], 'parsed',
  ),
  'GoogleChat.GroupTasks': cat(
    'GoogleChat', 'GroupTasks', 'Room tasks',
    'Tasks attached to a Chat room. No warrant layout was confirmed, so the file is shown from its header or as text. Worth a look only if it contains rows.',
    'header-table', ['generic'], 'generic',
  ),
  'GoogleFiWireless.UserInfo': cat(
    'GoogleFiWireless', 'UserInfo', 'Fi usage',
    'Fi call and message usage. A public export is a tab-separated file with start and end, the user number, usage type, direction, duration, the other number, equipment id, carrier, and wifi and voicemail flags. Those columns are read when the header has them. Usually worth opening.',
    'fi-userinfo', ['timeline', 'messages'], 'parsed',
  ),
  'GoogleFiWireless.Billing': cat(
    'GoogleFiWireless', 'Billing', 'Fi billing',
    'Fi billing. A warrant layout was not confirmed. Rows or labeled lines are shown as produced. Worth a look for account numbers and dates that are actually in the file.',
    'header-table', ['generic'], 'generic',
  ),
  'GoogleFiWireless.Messages': cat(
    'GoogleFiWireless', 'Messages', 'Fi messages',
    'Fi message content when Google produced it. No fixed column layout was confirmed, so the file opens from its header or as conversation rows when the headers are recognizable. Worth opening if it is not a No Data placeholder.',
    'header-table', ['messages'], 'generic',
  ),
  'GoogleFiWireless.Voicemails&Greetings': cat(
    'GoogleFiWireless', 'Voicemails&Greetings', 'Fi voicemail',
    'Voicemail and greeting audio. Audio files are listed with a player. A transcript is shown only when the file actually contains text. Worth opening when audio was produced.',
    'audio-list', ['media'], 'parsed',
  ),
  'GoogleMeet.ConferenceInformation': cat(
    'GoogleMeet', 'ConferenceInformation', 'Conference info',
    'Meet conference records. Column layout is not confirmed; the table follows the file header. Worth a look for meeting titles and times when those headers exist.',
    'header-table', ['generic'], 'generic',
  ),
  'GoogleMeet.MediaInformation': cat(
    'GoogleMeet', 'MediaInformation', 'Meet media',
    'Meet recordings or media metadata. Layout is not confirmed. Files are listed, and a table is shown when the file has a header. Worth a look when media was produced.',
    'header-table', ['media', 'generic'], 'generic',
  ),
  'GoogleMeet.MeetingHistory': cat(
    'GoogleMeet', 'MeetingHistory', 'Meeting history',
    'Meet meeting history. Layout is not confirmed; rows follow the header. Worth opening for dates if the file has them.',
    'header-table', ['timeline', 'generic'], 'generic',
  ),
  'GoogleMeet.ParticipantsInformation': cat(
    'GoogleMeet', 'ParticipantsInformation', 'Participants',
    'Meet participants. Layout is not confirmed; names and emails are kept when the header says so. Worth opening when rows exist.',
    'header-table', ['generic'], 'generic',
  ),
  'GoogleMeet.UserSessions': cat(
    'GoogleMeet', 'UserSessions', 'Sessions',
    'Meet session rows. Layout is not confirmed. A time column is used only when the header is a time or date. Worth a look.',
    'header-table', ['timeline', 'generic'], 'generic',
  ),
  'GooglePay.ConsumerTransactions': cat(
    'GooglePay', 'ConsumerTransactions', 'Transactions',
    'Google Pay transactions. A public CSV uses time, transaction id, description, product, payment method, status, and amount. Those are read when the header matches. Worth opening.',
    'pay-csv', ['timeline'], 'parsed',
  ),
  'GooglePay.P2pTransactions': cat(
    'GooglePay', 'P2pTransactions', 'Peer payments',
    'Person-to-person Pay transfers. A dedicated warrant layout was not confirmed, so rows follow the header, including amount and time columns when those headers exist. Worth opening when rows exist.',
    'header-table', ['timeline', 'generic'], 'generic',
  ),
  'GooglePay.Transit': cat(
    'GooglePay', 'Transit', 'Transit',
    'Transit activity stored in Pay. Layout is not confirmed. Shown from the header. Worth a look for times and places only when the file has those columns.',
    'header-table', ['generic'], 'generic',
  ),
  'GooglePay.Valuables': cat(
    'GooglePay', 'Valuables', 'Valuables',
    'Passes or valuables stored in Pay. Layout is not confirmed. Shown from the header. Worth a look if the file is not empty.',
    'header-table', ['generic'], 'generic',
  ),
  'GooglePay.Wallet': cat(
    'GooglePay', 'Wallet', 'Wallet',
    'Wallet instruments (cards or accounts) Google included. Layout is not confirmed. Shown from the header. Worth a look; do not assume a full card number was produced.',
    'header-table', ['generic'], 'generic',
  ),
  'GooglePhotos.PhotoResourceLegal': cat(
    'GooglePhotos', 'PhotoResourceLegal', 'Photos',
    'Photos and videos plus JSON sidecars. Sidecars can include a title, photo-taken time, creation time, and geoData coordinates. Times and coordinates feed Media and the map when they are present. Usually worth opening.',
    'photos-sidecar', ['media', 'locations'], 'parsed',
  ),
  'GooglePhotos.PrintSubscriptionAndOrdersResource': cat(
    'GooglePhotos', 'PrintSubscriptionAndOrdersResource', 'Print orders',
    'Photo print orders and subscriptions. Layout is not confirmed. Shown from the header. Worth a look for dates and shipping text that the file actually contains.',
    'header-table', ['generic'], 'generic',
  ),
  'Mail.Messages': cat(
    'Mail', 'Messages', 'Messages',
    'The mailbox, usually an mbox. Messages open in the Gmail browser with subject, from, to, date, and body. Worth opening. Very large mailboxes are read one message at a time.',
    'mbox', ['gmail', 'timeline'], 'parsed',
  ),
  'Mail.MessageInformation': cat(
    'Mail', 'MessageInformation', 'Message headers',
    'Message header details without a promise of the body. Read as a table when the file is CSV or delimited text. Header rows with a subject and a date also open in the Gmail browser. Worth opening for who wrote whom and when.',
    'mail-headers', ['gmail'], 'parsed',
  ),
  'Mail.UserSettings': cat(
    'Mail', 'UserSettings', 'Mail settings',
    'Gmail settings Google included. Layout is not confirmed. Shown from the header or as text. Usually low value unless a filter or forwarding address is in the file.',
    'header-table', ['generic'], 'generic',
  ),
  'Maps.AliasedPlacesResource': cat(
    'Maps', 'AliasedPlacesResource', 'Aliased places',
    'Labeled places. A public Maps file is GeoJSON: features with coordinates plus a name and address. Those are plotted when the coordinates are present. Worth opening.',
    'maps-geojson', ['locations'], 'parsed',
  ),
  'MyActivity.MyActivity': cat(
    'MyActivity', 'MyActivity', 'My Activity',
    'Search and app activity. Warrant copies are often HTML under My Activity. A JSON export uses header, title, title URL, time, products, and sometimes location. Queries, titles, and times are kept. Usually worth opening.',
    'my-activity', ['timeline'], 'parsed',
  ),
  'Saved.SavedCollections': cat(
    'Saved', 'SavedCollections', 'Saved places',
    'Saved collections. A public CSV uses title, note, item URL, and tags. Those columns are read when present, and a coordinate in a field is plotted. Worth opening for saved places.',
    'saved-csv', ['locations', 'generic'], 'parsed',
  ),
  'Timeline.Records': cat(
    'Timeline', 'Records', 'Location points',
    'Raw location points. Older files use Records.json locations[] with E7 latitude and longitude, accuracy, and a timestamp. Newer files use rawSignals with a "lat°, lng°" position, accuracy in meters, a source, and a timestamp. Points are plotted. Usually worth opening.',
    'timeline-records', ['locations', 'timeline'], 'parsed',
  ),
  'Timeline.SemanticLocationHistory': cat(
    'Timeline', 'SemanticLocationHistory', 'Visits and trips',
    'Visits and trips. Older files use timelineObjects (placeVisit and activitySegment) with E7 coordinates. Newer files use semanticSegments. Coordinates may be E7 numbers, a degree string, or a geo: string. Visits and trips are plotted. Usually worth opening.',
    'timeline-semantic', ['locations', 'timeline'], 'parsed',
  ),
  'Timeline.Settings': cat(
    'Timeline', 'Settings', 'Timeline settings',
    'Location History settings, including deviceSettings: a device tag, a display name, platform, and whether reporting was enabled. Use it to turn a device tag on a point into a device name. Worth opening once.',
    'timeline-settings', ['generic'], 'parsed',
  ),
  'Timeline.TimelineEdits': cat(
    'Timeline', 'TimelineEdits', 'Timeline edits',
    'Edits the user made to Location History. The schema was not confirmed. JSON or CSV is shown field-for-field, and a time is kept only when a field is clearly a time. Worth a look; do not assume a field meaning from its position.',
    'header-or-json', ['generic'], 'generic',
  ),
  'Timeline.Tombstones': cat(
    'Timeline', 'Tombstones', 'Tombstones',
    'Deleted Location History markers. Often CSV. The columns were not confirmed, so the table follows the header. Worth a look for deletion times only when a column is labeled as a time.',
    'header-table', ['generic'], 'generic',
  ),
  'Timeline.UserLocationProfile': cat(
    'Timeline', 'UserLocationProfile', 'Home and work',
    'Places Google labeled for the account, including HOME and WORK when a label field says so. A placeLocation may be a geo: string or coordinates. Those points are plotted and labeled. Worth opening.',
    'user-location-profile', ['locations'], 'parsed',
  ),
  'Timeline.EncryptedBackups': cat(
    'Timeline', 'EncryptedBackups', 'Encrypted backups',
    'Location History backups encrypted by Google. The text file identifies them; the ciphertext cannot be decrypted here. Flagged as not viewable. Not worth trying to open as a document.',
    'encrypted-flag', [], 'flagged',
  ),
  'Voice.Communications': cat(
    'Voice', 'Communications', 'Texts, calls, voicemail',
    'Google Voice conversations as HTML, plus MP3 voicemail or recordings when those files were produced. A public export uses a chat log with a time, a sender, a phone number, and the text. Calls, texts, and voicemail with a linked audio file open in the conversation view. Usually worth opening.',
    'voice-html', ['messages', 'media', 'timeline'], 'parsed',
  ),
  'Voice.ContactsMetadata': cat(
    'Voice', 'ContactsMetadata', 'Voice contacts',
    'Voice contacts, often Phones.vcf. Read as vCards. Worth opening for numbers saved in Voice.',
    'vcf', ['generic'], 'parsed',
  ),
  'Voice.Billing': cat(
    'Voice', 'Billing', 'Voice billing',
    'Voice billing pages. Layout is not confirmed. Labeled lines are shown as written. Worth a look for the number and dates that appear in the file.',
    'labeled-html', ['generic'], 'generic',
  ),
  'Voice.SubscriberInformation': cat(
    'Voice', 'SubscriberInformation', 'Voice subscriber',
    'Voice subscriber page: the Voice number and account text Google included. Layout is not confirmed. Worth opening for the number when it is in the page.',
    'labeled-html', ['generic'], 'parsed',
  ),
};

/** Category ids whose folder number is not the account GAIA id. */
export const NON_GAIA_PRODUCTS = new Set(['AndroidDeviceConfigurationService']);

export function categoryId(product: string, category: string): string {
  return `${product}.${category}`;
}

export function lookupCategory(product: string, category: string): GoogleCategoryDef | null {
  if (!product) return null;
  const direct = GOOGLE_CATEGORIES[categoryId(product, category)];
  if (direct) return direct;
  if (product === 'GoogleAccountTargetAssociation' && category.startsWith('LinkedBy')) {
    return {
      ...GOOGLE_CATEGORIES['GoogleAccountTargetAssociation.LinkedByAndroidProfile'],
      id: categoryId(product, category),
      category,
      label: category.replace(/([A-Z])/g, ' $1').replace(/^ /, '').replace('Linked By', 'Linked by'),
    };
  }
  if (product === 'DriveAssociatedTargets' && /shareddrive|teamdrive/i.test(category.replace(/[^a-z]/gi, ''))) {
    return { ...GOOGLE_CATEGORIES['DriveAssociatedTargets.SharedDrives'], id: categoryId(product, category), category };
  }
  return null;
}

/** Label for a stored `Product.Category` id, including categories that are only in the generic viewer. */
export function labelForGoogleCategoryId(id: string, productHint?: string): string {
  const raw = (id || '').trim();
  if (!raw) return '';
  const product = (productHint || raw.split('.')[0] || '').trim();
  const category = product && raw.startsWith(`${product}.`) ? raw.slice(product.length + 1) : raw;
  return describeCategory(product, category).label;
}

export function describeCategory(product: string, category: string): GoogleCategoryDef {
  const known = lookupCategory(product, category);
  if (known) return known;
  const productDef = GOOGLE_PRODUCTS[product];
  return {
    id: categoryId(product || 'Google', category || 'File'),
    product: product || 'Google',
    category: category || 'File',
    label: category || 'Unlisted file',
    group: productDef?.label || product || 'Google',
    description: productDef
      ? `${productDef.description} This folder (${category || 'unlisted'}) is not one of the categories mapped for a dedicated view. It opens in the generic viewer, so the file is still visible.`
      : `This folder is not in the mapped Google category list (${product || 'unknown'}.${category || 'file'}). Nothing is hidden: the file opens in the generic viewer. A description will be wrong if it guessed a meaning, so none is guessed here.`,
    parser: 'generic',
    feeds: ['generic'],
    mode: 'generic',
  };
}

export function productDef(product: string): GoogleProductDef {
  return GOOGLE_PRODUCTS[product] || {
    id: product || 'Google',
    label: product || 'Other Google files',
    description: 'Files whose product name is not in the mapped list. They stay visible in the generic viewer. No meaning is inferred from the product name alone.',
  };
}
