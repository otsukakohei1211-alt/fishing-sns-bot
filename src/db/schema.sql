-- ── 魚種マスター ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fish (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT    NOT NULL UNIQUE,  -- 日本語名 (例: イシモチ)
  name_kana        TEXT,                     -- カタカナ読み
  scientific_name  TEXT,                     -- 学名
  aliases          TEXT    DEFAULT '[]',     -- JSON: 別名リスト ["シログチ","グチ"]
  category         TEXT,                     -- 魚/甲殻類/イカタコ/貝類
  typical_size_min REAL,
  typical_size_max REAL,
  size_unit        TEXT    DEFAULT 'cm',
  best_season      TEXT    DEFAULT '[]',     -- JSON: ["spring","summer","autumn","winter"]
  habitat          TEXT,                     -- 底物/表層/中層
  danger_level     INTEGER DEFAULT 0,        -- 0=無害 1=トゲ注意 2=毒トゲ 3=毒魚
  danger_note      TEXT,                     -- 具体的な注意点
  price_range      INTEGER DEFAULT 2,        -- 1=安価 2=普通 3=高級 4=超高級
  difficulty       INTEGER DEFAULT 3,        -- 1=初心者OK ～ 5=上級者向け
  taste_profile    TEXT    DEFAULT '{}',     -- JSON: {texture, fat_content, flavor}
  is_active        INTEGER DEFAULT 1,        -- 1=本牧データに出現実績あり
  created_at       TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── 魚種コンテンツ（料理・豆知識のみ） ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fish_content (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  fish_id          INTEGER NOT NULL UNIQUE REFERENCES fish(id),
  cooking_advice   TEXT,   -- 食べ方・レシピ・下処理
  fun_fact         TEXT,   -- 豆知識・生態・特徴
  content_source   TEXT    DEFAULT 'ai_generated',  -- ai_generated / human_reviewed
  generated_at     TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── 日次釣果記録 ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS catch_records (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  date      TEXT    NOT NULL,                -- YYYY/MM/DD
  facility  TEXT    NOT NULL,                -- honmoku / daikoku / isogo
  fish_id   INTEGER REFERENCES fish(id),
  fish_name TEXT    NOT NULL,                -- 非正規化（名前変更への耐性）
  count     INTEGER NOT NULL DEFAULT 0,
  min_size  REAL    NOT NULL DEFAULT 0,
  max_size  REAL    NOT NULL DEFAULT 0,
  unit      TEXT    NOT NULL DEFAULT 'cm',
  places    TEXT    NOT NULL DEFAULT '[]',   -- JSON: ["第1","第2"]
  UNIQUE(date, facility, fish_name)
);

-- ── 日次海況 ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_conditions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT    NOT NULL,
  facility    TEXT    NOT NULL,
  weather     TEXT,
  water_temp  REAL,
  tide        TEXT,
  visitors    INTEGER,
  wind_speed        REAL,    -- Open-Meteo (m/s)
  wave_height       REAL,    -- Open-Meteo (m)
  pressure          REAL,    -- 海面気圧 (hPa)
  precipitation     REAL,    -- 降水量 (mm)
  temp_max          REAL,    -- 最高気温 (℃)
  temp_min          REAL,    -- 最低気温 (℃)
  moon_age          REAL,    -- 月齢 (0〜29.5)
  water_temp_change REAL,    -- 前日比水温変化 (℃)
  comment           TEXT,    -- 施設コメント原文
  fetched_at        TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(date, facility)
);

-- ── 施設コメントから抽出した観察記録 ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fish_observations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  date         TEXT    NOT NULL,
  facility     TEXT    NOT NULL,
  fish_id      INTEGER REFERENCES fish(id),
  fish_name    TEXT    NOT NULL,
  raw_text     TEXT,            -- コメント原文の該当部分
  tackle       TEXT,            -- 仕掛け: ぶっこみ/サビキ/ウキ/ルアー等
  bait         TEXT,            -- エサ: アオイソメ/コマセ/アミエビ等
  spot_detail  TEXT,            -- 場所: 外側/内側/手前/奥等
  time_of_day  TEXT,            -- 朝/昼/夕/終日等
  water_depth  TEXT,            -- 水深（言及があれば）
  notes        TEXT,            -- その他特記事項
  extracted_by TEXT    NOT NULL DEFAULT 'claude'
);

-- ── 仕掛け・エサ出現頻度統計 ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fish_tactic_stats (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  fish_id       INTEGER NOT NULL REFERENCES fish(id),
  tactic_type   TEXT    NOT NULL,  -- tackle / bait / spot / time
  tactic_value  TEXT    NOT NULL,
  mention_count INTEGER NOT NULL DEFAULT 0,
  co_catch_count INTEGER NOT NULL DEFAULT 0,  -- 実際に釣れた日との一致数
  last_seen     TEXT,
  UNIQUE(fish_id, tactic_type, tactic_value)
);

-- ── 投稿ログ ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS post_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  posted_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  post_type    TEXT    NOT NULL,  -- daily_catch / fish_feature
  fish_id      INTEGER REFERENCES fish(id),
  facility     TEXT    NOT NULL,
  content_text TEXT,
  x_tweet_id   TEXT,
  status       TEXT    NOT NULL DEFAULT 'success'  -- success / failed / skipped
);

-- ── インデックス ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_catch_date_facility   ON catch_records(date, facility);
CREATE INDEX IF NOT EXISTS idx_catch_fish_id         ON catch_records(fish_id);
CREATE INDEX IF NOT EXISTS idx_conditions_date       ON daily_conditions(date, facility);
CREATE INDEX IF NOT EXISTS idx_observations_fish     ON fish_observations(fish_id, date);
CREATE INDEX IF NOT EXISTS idx_observations_date     ON fish_observations(date, facility);
CREATE INDEX IF NOT EXISTS idx_tactic_fish           ON fish_tactic_stats(fish_id);
CREATE INDEX IF NOT EXISTS idx_post_log_type         ON post_log(post_type, posted_at);
