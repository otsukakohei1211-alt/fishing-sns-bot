export type Facility = "honmoku" | "daikoku" | "isogo";

export type Catch = {
  name: string;
  minSize: number;
  maxSize: number;
  unit: string; // "cm" | "kg"
  count: number;
  places: string[];
};

export type DailyReport = {
  facility: Facility;
  date: string; // YYYY/MM/DD
  weather: string;
  waterTemp: string;
  tide: string;
  visitors: number;
  comment: string; // sentence
  catches: Catch[];
  fetchedAt: string; // ISO
};
