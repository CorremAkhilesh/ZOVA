const list = (emojis: string) => emojis.split(' ');

/** Labels are `emoji.<id>` in the locale files. */
export const EMOJI_GROUPS = [
  {
    id: 'smileys',
    icon: '😀',
    emojis: list(
      '😀 😃 😄 😁 😆 😅 😂 🤣 😊 🙂 😉 😍 🥰 😘 😎 🤩 🥳 😇 🤗 🤔 🤨 😐 😴 😌 😕 🙁 😢 😭 😤 😡 🤯 😳 🥺 😱 😬 🙄 🤐 🤒 🤕 🥱',
    ),
  },
  {
    id: 'gestures',
    icon: '👍',
    emojis: list(
      '👍 👎 👌 ✌️ 🤞 🤝 👏 🙌 🙏 💪 👋 🤙 👉 👈 👆 👇 ✋ 🤚 🤲 🫶 ❤️ 🧡 💛 💚 💙 💜 🖤 💯 🔥 ⭐ ✨ 🎉 🎊 ✅ ❌ ❗ ❓ 💡 📌 🚀',
    ),
  },
  {
    id: 'work',
    icon: '💼',
    emojis: list(
      '💼 📅 📈 📉 📊 📝 📎 📁 📂 📄 🖨️ 💻 ⌨️ 🖥️ 📱 📞 ✉️ 📧 🔒 🔑 ⏰ ⏳ 🗓️ 💰 💳 🧾 🏢 🗂️ 🧮 🔍 🛠️ ⚙️ 🧑‍💻 🤖 ☕ 🍵 🍕 🍔 🍰 🎂',
    ),
  },
  {
    id: 'life',
    icon: '🌍',
    emojis: list(
      '🌍 🌞 🌙 ⛅ 🌧️ ⛈️ ❄️ 🌈 🌸 🌻 🌳 🍀 🐶 🐱 🐦 🦋 🚗 🚕 🚌 🚆 ✈️ 🏠 🏖️ ⛰️ 🏏 ⚽ 🏸 🎮 🎬 🎵 🎧 📚 🎁 🎈 🪔 🕉️ 🇮🇳 🏆 🥇 🧘',
    ),
  },
] as const;

export type EmojiGroup = (typeof EMOJI_GROUPS)[number];
