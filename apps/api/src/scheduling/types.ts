export type Interval = {
  start: number;
  end: number;
};

export type Slot = Interval;

export type AvailabilityWindow = Interval & {
  localDate: string;
};

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type TimeOfDay = {
  startMinute: number;
  endMinute: number;
};

export type WeeklyAvailability = Record<Weekday, TimeOfDay[]>;

export type ExpandWeeklyInput = {
  timeZone: string;
  weekly: WeeklyAvailability;
  rangeStart: number;
  rangeEnd: number;
  excludeLocalDates?: ReadonlyArray<string>;
};

export type ComputeSlotsInput = {
  rangeStart: number;
  rangeEnd: number;
  windows: ReadonlyArray<AvailabilityWindow>;
  busy: ReadonlyArray<Interval>;
  durationMinutes: number;
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
  slotIntervalMinutes?: number;
  maxPerDay?: number;
};
