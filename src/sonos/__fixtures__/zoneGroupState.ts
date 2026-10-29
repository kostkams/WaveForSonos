/**
 * Realistic ZoneGroupState fixtures (attribute set trimmed but in Sonos' shape).
 * - Living Room: stereo pair of two One SLs (right channel is Invisible="1").
 * - TV Room: Arc with Sub + two surrounds as <Satellite> children.
 * - Kitchen + Bathroom grouped, Kitchen coordinating.
 * - A BOOST zone bridge in its own group.
 */
const el = (tag: string, attrs: Record<string, string>, children = '') =>
  `<${tag} ${Object.entries(attrs)
    .map(([k, v]) => `${k}="${v.replace(/&/g, '&amp;')}"`)
    .join(' ')}${children ? `>${children}</${tag}>` : '/>'}`;
const member = (attrs: Record<string, string>, children = '') => el('ZoneGroupMember', attrs, children);
const satellite = (attrs: Record<string, string>) => el('Satellite', attrs);

const common = (ip: string) => ({
  Location: `http://${ip}:1400/xml/device_description.xml`,
  SoftwareVersion: '83.1-61240',
  SWGen: '2',
  MinCompatibleVersion: '82.0-00000',
  LegacyCompatibleVersion: '58.0-00000',
  BootSeq: '42',
  TVConfigurationError: '0',
  HdmiCecAvailable: '0',
  WirelessMode: '0',
  WirelessLeafOnly: '0',
  ChannelFreq: '2437',
  BehindWifiExtender: '0',
  WifiEnabled: '1',
  EthLink: '0',
  Orientation: '0',
  RoomCalibrationState: '4',
  SecureRegState: '3',
  VoiceConfigState: '0',
  MicEnabled: '0',
  AirPlayEnabled: '1',
  IdleState: '1',
  MoreInfo: '',
});

const groupsXml =
  '<ZoneGroups>' +
  '<ZoneGroup Coordinator="RINCON_48A6B8100001001400" ID="RINCON_48A6B8100001001400:1234567890">' +
  member({ UUID: 'RINCON_48A6B8100001001400', ...common('192.168.1.20'), ZoneName: 'Living Room', Icon: '', Configuration: '1', ChannelMapSet: 'RINCON_48A6B8100001001400:LF,LF;RINCON_48A6B8100002001400:RF,RF' }) +
  member({ UUID: 'RINCON_48A6B8100002001400', ...common('192.168.1.21'), ZoneName: 'Living Room', Icon: '', Configuration: '1', Invisible: '1', ChannelMapSet: 'RINCON_48A6B8100001001400:LF,LF;RINCON_48A6B8100002001400:RF,RF' }) +
  '</ZoneGroup>' +
  '<ZoneGroup Coordinator="RINCON_542A1B200001001400" ID="RINCON_542A1B200001001400:987654321">' +
  member(
    { UUID: 'RINCON_542A1B200001001400', ...common('192.168.1.30'), ZoneName: 'TV Room', Icon: '', Configuration: '1', HTSatChanMapSet: 'RINCON_542A1B200001001400:LF,RF;RINCON_542A1B200002001400:SW;RINCON_542A1B200003001400:LR;RINCON_542A1B200004001400:RR' },
    satellite({ UUID: 'RINCON_542A1B200002001400', ...common('192.168.1.31'), ZoneName: 'TV Room', Icon: '', Configuration: '1', Invisible: '1' }) +
      satellite({ UUID: 'RINCON_542A1B200003001400', ...common('192.168.1.32'), ZoneName: 'TV Room', Icon: '', Configuration: '1', Invisible: '1' }) +
      satellite({ UUID: 'RINCON_542A1B200004001400', ...common('192.168.1.33'), ZoneName: 'TV Room', Icon: '', Configuration: '1', Invisible: '1' }),
  ) +
  '</ZoneGroup>' +
  '<ZoneGroup Coordinator="RINCON_949F3E300001001400" ID="RINCON_949F3E300001001400:55">' +
  member({ UUID: 'RINCON_5CAAFD300002001400', ...common('192.168.1.41'), ZoneName: 'Bathroom & Sauna', Icon: '', Configuration: '1' }) +
  member({ UUID: 'RINCON_949F3E300001001400', ...common('192.168.1.40'), ZoneName: 'Kitchen', Icon: '', Configuration: '1' }) +
  '</ZoneGroup>' +
  '<ZoneGroup Coordinator="RINCON_000E58F00001001400" ID="RINCON_000E58F00001001400:7">' +
  member({ UUID: 'RINCON_000E58F00001001400', ...common('192.168.1.50'), ZoneName: 'BOOST', Icon: '', Configuration: '1', IsZoneBridge: '1' }) +
  '</ZoneGroup>' +
  '</ZoneGroups>';

/** Satellites are self-closing <Satellite .../> children of the HT ZoneGroupMember. */
export const NEW_FORMAT = `<ZoneGroupState>${groupsXml}<VanishedDevices></VanishedDevices></ZoneGroupState>`;
export const OLD_FORMAT = groupsXml;
