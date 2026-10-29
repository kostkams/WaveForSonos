/// <reference types="jest" />
import { findCoordinatorIp, getZoneGroups, ipFromLocation, parseZoneGroupState, ZoneGroup } from '..';
import { esc, mockFetch, soapResponse, ZGT } from '../__fixtures__/helpers';
import { NEW_FORMAT, OLD_FORMAT } from '../__fixtures__/zoneGroupState';

const expected: ZoneGroup[] = [
  {
    id: 'RINCON_48A6B8100001001400:1234567890',
    coordinatorUuid: 'RINCON_48A6B8100001001400',
    coordinatorIp: '192.168.1.20',
    members: [
      {
        uuid: 'RINCON_48A6B8100001001400',
        name: 'Living Room',
        ip: '192.168.1.20',
        location: 'http://192.168.1.20:1400/xml/device_description.xml',
        isCoordinator: true,
        invisible: false,
      },
    ],
  },
  {
    id: 'RINCON_542A1B200001001400:987654321',
    coordinatorUuid: 'RINCON_542A1B200001001400',
    coordinatorIp: '192.168.1.30',
    members: [
      {
        uuid: 'RINCON_542A1B200001001400',
        name: 'TV Room',
        ip: '192.168.1.30',
        location: 'http://192.168.1.30:1400/xml/device_description.xml',
        isCoordinator: true,
        invisible: false,
      },
    ],
  },
  {
    id: 'RINCON_949F3E300001001400:55',
    coordinatorUuid: 'RINCON_949F3E300001001400',
    coordinatorIp: '192.168.1.40',
    members: [
      {
        uuid: 'RINCON_949F3E300001001400',
        name: 'Kitchen',
        ip: '192.168.1.40',
        location: 'http://192.168.1.40:1400/xml/device_description.xml',
        isCoordinator: true,
        invisible: false,
      },
      {
        uuid: 'RINCON_5CAAFD300002001400',
        name: 'Bathroom & Sauna',
        ip: '192.168.1.41',
        location: 'http://192.168.1.41:1400/xml/device_description.xml',
        isCoordinator: false,
        invisible: false,
      },
    ],
  },
];

describe('parseZoneGroupState', () => {
  it('parses the wrapped (new) format, dropping invisible members, satellites and bridges', () => {
    expect(parseZoneGroupState(NEW_FORMAT)).toEqual(expected);
  });

  it('parses the old <ZoneGroups> root format identically', () => {
    expect(parseZoneGroupState(OLD_FORMAT)).toEqual(expected);
  });

  it('handles a single group / single member and empty input', () => {
    const xml =
      '<ZoneGroupState><ZoneGroups><ZoneGroup Coordinator="RINCON_A" ID="RINCON_A:1">' +
      '<ZoneGroupMember UUID="RINCON_A" Location="http://10.0.0.5:1400/xml/device_description.xml" ZoneName="Office"/>' +
      '</ZoneGroup></ZoneGroups></ZoneGroupState>';
    const groups = parseZoneGroupState(xml);
    expect(groups).toHaveLength(1);
    expect(groups[0].coordinatorIp).toBe('10.0.0.5');
    expect(groups[0].members[0].name).toBe('Office');
    expect(parseZoneGroupState('')).toEqual([]);
    expect(parseZoneGroupState('<ZoneGroupState><ZoneGroups></ZoneGroups></ZoneGroupState>')).toEqual([]);
  });
});

describe('getZoneGroups', () => {
  it('unescapes the ZoneGroupState argument from the SOAP response', async () => {
    const calls = mockFetch({
      body: soapResponse('GetZoneGroupState', ZGT, `<ZoneGroupState>${esc(NEW_FORMAT)}</ZoneGroupState>`),
    });
    const groups = await getZoneGroups('192.168.1.20');
    expect(groups).toEqual(expected);
    expect(calls[0].url).toBe('http://192.168.1.20:1400/ZoneGroupTopology/Control');
    expect((calls[0].init.headers as Record<string, string>).SOAPACTION).toBe(`"${ZGT}#GetZoneGroupState"`);
  });
});

describe('helpers', () => {
  it('ipFromLocation', () => {
    expect(ipFromLocation('http://192.168.1.20:1400/xml/device_description.xml')).toBe('192.168.1.20');
    expect(ipFromLocation('garbage')).toBe('');
  });

  it('findCoordinatorIp', () => {
    expect(findCoordinatorIp(expected, '192.168.1.41')).toBe('192.168.1.40');
    expect(findCoordinatorIp(expected, '192.168.1.40')).toBe('192.168.1.40');
    expect(findCoordinatorIp(expected, '192.168.1.20')).toBe('192.168.1.20');
    expect(findCoordinatorIp(expected, '10.9.9.9')).toBeNull();
  });
});
