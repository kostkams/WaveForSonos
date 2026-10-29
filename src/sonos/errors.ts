/** Typed error thrown by the SOAP layer. */

const UPNP_ERROR_DESCRIPTIONS: Record<number, string> = {
  401: 'Invalid action',
  402: 'Invalid arguments',
  501: 'Action failed',
  701: 'Transition not available',
  702: 'No contents',
  703: 'Read error',
  704: 'Unsupported format for playback',
  705: 'Transport is locked',
  706: 'Write error',
  707: 'Media is protected or not writable',
  708: 'Unsupported format for recording',
  709: 'Media is full',
  710: 'Seek mode not supported',
  711: 'Illegal seek target',
  712: 'Play mode not supported',
  713: 'Record quality not supported',
  714: 'Illegal MIME-type',
  715: 'Content busy',
  716: 'Resource not found',
  717: 'Play speed not supported',
  718: 'Invalid InstanceID',
  737: 'No DNS server',
  738: 'Bad domain name',
  739: 'Server error',
  800: 'Command not supported or not a coordinator',
};

export function describeUpnpError(code: number): string | undefined {
  return UPNP_ERROR_DESCRIPTIONS[code];
}

export type SonosErrorKind = 'upnp' | 'http' | 'timeout' | 'network' | 'parse';

export class SonosError extends Error {
  /** UPnP error code (e.g. 701), or HTTP status for kind 'http', or null. */
  readonly code: number | null;
  readonly description: string;
  readonly kind: SonosErrorKind;
  readonly action?: string;
  readonly ip?: string;

  constructor(opts: {
    kind: SonosErrorKind;
    code?: number | null;
    description: string;
    action?: string;
    ip?: string;
  }) {
    const where = opts.action ? `${opts.action}${opts.ip ? ` @ ${opts.ip}` : ''}: ` : '';
    const codePart = opts.code != null ? ` (${opts.code})` : '';
    super(`Sonos ${where}${opts.description}${codePart}`);
    this.name = 'SonosError';
    this.kind = opts.kind;
    this.code = opts.code ?? null;
    this.description = opts.description;
    this.action = opts.action;
    this.ip = opts.ip;
    Object.setPrototypeOf(this, SonosError.prototype);
  }

  get isTransitionNotAvailable(): boolean {
    return this.code === 701;
  }
  get isIllegalMimeType(): boolean {
    return this.code === 714;
  }
  get isNotCoordinator(): boolean {
    return this.code === 800;
  }
}
