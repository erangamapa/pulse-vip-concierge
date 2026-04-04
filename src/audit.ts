export type AuditKind = 'inbound' | 'outbound' | 'tool' | 'refused' | 'linked' | 'notify';

export interface AuditEntry {
  seq: number;
  at: string;
  kind: AuditKind;
  threadId: string;
  customerId?: string;
  detail: Readonly<Record<string, unknown>>;
}

export type AuditInput = Omit<AuditEntry, 'seq' | 'at'>;

export interface AuditLog {
  append(entry: AuditInput): Promise<void>;
}

export class InMemoryAuditLog implements AuditLog {
  private readonly rows: AuditEntry[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  async append(entry: AuditInput): Promise<void> {
    this.rows.push({ ...entry, seq: this.rows.length + 1, at: this.now().toISOString() });
  }

  entries(): readonly AuditEntry[] {
    return this.rows;
  }
}
