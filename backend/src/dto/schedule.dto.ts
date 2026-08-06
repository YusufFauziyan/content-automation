/** A standing instruction to make videos without being asked. */
export interface ScheduleDto {
  readonly id: string;
  readonly name: string;
  readonly language: string;
  readonly intervalMinutes: number;
  readonly enabled: boolean;
  readonly nextRunAt: Date;
  readonly lastRunAt: Date | null;
  readonly runsStarted: number;
  readonly lastError: string | null;
  readonly createdAt: Date;
}

export interface NewScheduleDto {
  readonly name: string;
  readonly language: string;
  readonly intervalMinutes: number;
  /** When it should first fire. Defaults to one interval from now. */
  readonly nextRunAt?: Date;
}

export interface ScheduleUpdateDto {
  readonly name?: string;
  readonly language?: string;
  readonly intervalMinutes?: number;
  readonly enabled?: boolean;
  readonly nextRunAt?: Date;
  readonly lastRunAt?: Date;
  readonly runsStarted?: number;
  readonly lastError?: string | null;
}

/** The fields an operator may change after a schedule exists. */
export interface ScheduleEditDto {
  readonly name?: string;
  readonly language?: string;
  readonly intervalMinutes?: number;
  readonly enabled?: boolean;
}
