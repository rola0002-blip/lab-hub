// Curated, dependency-free shortname → glyph map for chat rendering and the
// Task 12 emoji picker. Deliberately small (~130 common shortnames) rather than a
// full Unicode set: keeps the client bundle tiny and covers everyday lab chatter.
// Consumers: markdown.ts (`:shortname:` resolution), the emoji picker (Task 12),
// and search-result excerpt rendering (Tasks 15/17). Keep the exported names
// (`EMOJI_MAP`, `emojiFor`, `searchEmoji`) stable — those tasks import them.
export const EMOJI_MAP: Record<string, string> = {
  // Reactions / hands
  '+1': '👍', '-1': '👎', thumbsup: '👍', thumbsdown: '👎',
  ok_hand: '👌', clap: '👏', raised_hands: '🙌', pray: '🙏',
  wave: '👋', point_up: '☝️', point_down: '👇', point_left: '👈', point_right: '👉',
  muscle: '💪', handshake: '🤝', fist: '✊', punch: '👊', v: '✌️', crossed_fingers: '🤞',
  // Smileys / faces
  smile: '😄', smiley: '😃', grin: '😁', laughing: '😆', joy: '😂', rofl: '🤣',
  slightly_smiling_face: '🙂', wink: '😉', blush: '😊', innocent: '😇',
  heart_eyes: '😍', kissing_heart: '😘', yum: '😋', sunglasses: '😎',
  smirk: '😏', thinking: '🤔', thinking_face: '🤔', neutral_face: '😐',
  expressionless: '😑', unamused: '😒', roll_eyes: '🙄', grimacing: '😬',
  relieved: '😌', pensive: '😔', confused: '😕', worried: '😟',
  cry: '😢', sob: '😭', sweat: '😓', sweat_smile: '😅', weary: '😩',
  tired_face: '😫', fearful: '😨', cold_sweat: '😰', scream: '😱',
  angry: '😠', rage: '😡', triumph: '😤', sleepy: '😪', sleeping: '😴',
  mask: '😷', nerd_face: '🤓', star_struck: '🤩', partying_face: '🥳',
  exploding_head: '🤯', shushing_face: '🤫', face_with_monocle: '🧐',
  upside_down_face: '🙃', money_mouth_face: '🤑', hugging_face: '🤗',
  zany_face: '🤪', flushed: '😳', astonished: '😲', hushed: '😯',
  yawning_face: '🥱', woozy_face: '🥴', ghost: '👻', alien: '👽', robot: '🤖',
  poop: '💩', skull: '💀', clown_face: '🤡',
  // Hearts / symbols
  heart: '❤️', orange_heart: '🧡', yellow_heart: '💛', green_heart: '💚',
  blue_heart: '💙', purple_heart: '💜', black_heart: '🖤', broken_heart: '💔',
  sparkling_heart: '💖', two_hearts: '💕',
  // Celebration / objects
  tada: '🎉', confetti_ball: '🎊', balloon: '🎈', gift: '🎁', trophy: '🏆',
  medal: '🏅', sparkles: '✨', star: '⭐', star2: '🌟', fire: '🔥', boom: '💥',
  zap: '⚡', bulb: '💡', rocket: '🚀', crown: '👑', gem: '💎', dart: '🎯',
  // Checks / status
  white_check_mark: '✅', heavy_check_mark: '✔️', ballot_box_with_check: '☑️',
  x: '❌', negative_squared_cross_mark: '❎', warning: '⚠️', no_entry: '⛔',
  no_entry_sign: '🚫', question: '❓', exclamation: '❗', bangbang: '‼️',
  100: '💯', eyes: '👀', wrench: '🔧', hammer: '🔨', lock: '🔒', unlock: '🔓', key: '🔑',
  // Time / nature
  clock: '🕐', hourglass: '⏳', calendar: '📅', alarm_clock: '⏰',
  sunny: '☀️', cloud: '☁️', rain: '🌧️', snowflake: '❄️', rainbow: '🌈',
  moon: '🌙', earth_americas: '🌎', seedling: '🌱', herb: '🌿', deciduous_tree: '🌳',
  // Food / drink
  coffee: '☕', tea: '🍵', beer: '🍺', beers: '🍻', wine_glass: '🍷',
  champagne: '🍾', pizza: '🍕', hamburger: '🍔', cake: '🍰', birthday: '🎂',
  cookie: '🍪', doughnut: '🍩', apple: '🍎', banana: '🍌',
  // Work / science / lab
  microscope: '🔬', telescope: '🔭', test_tube: '🧪', dna: '🧬', atom: '⚛️',
  computer: '💻', keyboard: '⌨️', printer: '🖨️', battery: '🔋', electric_plug: '🔌',
  satellite: '🛰️', gear: '⚙️', chart_with_upwards_trend: '📈',
  chart_with_downwards_trend: '📉', bar_chart: '📊', clipboard: '📋',
  pushpin: '📌', paperclip: '📎', memo: '📝', pencil: '✏️', books: '📚',
  book: '📖', mag: '🔍', envelope: '✉️', email: '📧', bell: '🔔', mute: '🔇',
  loudspeaker: '📢', mega: '📣', hourglass_flowing_sand: '⏳',
  // Misc / fun
  eyes_wide: '😳', wave_hand: '👋', ok: '🆗', new: '🆕', cool: '🆒',
  recycle: '♻️', infinity: '♾️', musical_note: '🎵', notes: '🎶',
  soccer: '⚽', basketball: '🏀', tennis: '🎾', checkered_flag: '🏁',
  hot_beverage: '☕', snowman: '⛄', umbrella: '☔', anchor: '⚓',
}

// Resolve a bare shortname (no surrounding colons) to its glyph, or null if
// unknown so callers can fall back to rendering the literal `:name:` text.
export function emojiFor(shortname: string): string | null {
  return Object.prototype.hasOwnProperty.call(EMOJI_MAP, shortname) ? EMOJI_MAP[shortname] : null
}

// Case-insensitive substring search over shortnames for the emoji picker.
// Returns matches in map order; empty query yields all entries.
export function searchEmoji(q: string): { shortname: string; glyph: string }[] {
  const needle = q.trim().toLowerCase()
  return Object.entries(EMOJI_MAP)
    .filter(([shortname]) => shortname.includes(needle))
    .map(([shortname, glyph]) => ({ shortname, glyph }))
}
