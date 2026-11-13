/** "What's new" on Help → About, newest first. Plain words for people, not developers. */
export interface WhatsNewEntry {
  id: string;
  en: { title: string; items: readonly string[] };
  hi: { title: string; items: readonly string[] };
}

export const WHATS_NEW: readonly WhatsNewEntry[] = [
  {
    id: 'help',
    en: {
      title: 'Help and polish',
      items: [
        'Help & About: install guides, common questions, privacy and contact',
        'Many small fixes to make everyday use smoother',
      ],
    },
    hi: {
      title: 'मदद और सुधार',
      items: [
        'मदद और जानकारी: इंस्टॉल करने का तरीका, आम सवाल, प्राइवेसी और संपर्क',
        'रोज़ के इस्तेमाल को आसान बनाने के लिए कई छोटे सुधार',
      ],
    },
  },
  {
    id: 'notifications',
    en: {
      title: 'Notifications',
      items: [
        'Get notified about new messages, even when the app is closed',
        'Unread count on the app icon, and sounds you can turn off',
      ],
    },
    hi: {
      title: 'नोटिफ़िकेशन',
      items: [
        'ऐप बंद होने पर भी नए मैसेज का नोटिफ़िकेशन',
        'ऐप आइकन पर बिना पढ़े मैसेज की गिनती, और आवाज़ जिसे बंद कर सकते हैं',
      ],
    },
  },
  {
    id: 'power',
    en: {
      title: 'Scheduling, polls and more privacy',
      items: [
        'Schedule a message to send later, and create polls',
        'Disappearing messages and view once photos and videos',
        'Lock chats or the whole app with a PIN',
        'Quiet hours, accent colors and chat wallpapers',
      ],
    },
    hi: {
      title: 'शेड्यूल, पोल और ज़्यादा प्राइवेसी',
      items: [
        'मैसेज बाद में भेजने के लिए शेड्यूल करें, और पोल बनाएँ',
        'गायब होने वाले मैसेज और एक बार देखी जा सकने वाली फ़ोटो-वीडियो',
        'PIN से चैट या पूरा ऐप लॉक करें',
        'शांत समय, एक्सेंट रंग और चैट वॉलपेपर',
      ],
    },
  },
  {
    id: 'organize',
    en: {
      title: 'Stay organized',
      items: [
        'Chat folders, pinned messages and @mentions',
        'Drafts that follow you to your other devices',
        'Press Ctrl+K (⌘K on Mac) to find anything or run a command',
      ],
    },
    hi: {
      title: 'सब कुछ व्यवस्थित',
      items: [
        'चैट फ़ोल्डर, पिन किए मैसेज और @mention',
        'अधूरे मैसेज (ड्राफ़्ट) आपके दूसरे डिवाइस पर भी',
        'कुछ भी ढूँढने या कमांड चलाने के लिए Ctrl+K (Mac पर ⌘K) दबाएँ',
      ],
    },
  },
  {
    id: 'search',
    en: {
      title: 'Search and safety',
      items: [
        'Search all your chats and messages',
        'Block someone, or report a person, group or message',
        'Link previews and rich text formatting',
      ],
    },
    hi: {
      title: 'खोज और सुरक्षा',
      items: [
        'अपनी सभी चैट और मैसेज में खोजें',
        'किसी को ब्लॉक करें, या व्यक्ति, ग्रुप या मैसेज की रिपोर्ट करें',
        'लिंक प्रीव्यू और टेक्स्ट फ़ॉर्मैटिंग',
      ],
    },
  },
  {
    id: 'actions',
    en: {
      title: 'Message actions',
      items: [
        'Reply, forward, copy, edit, react and star messages',
        'Delete for everyone, pin, mute and archive chats',
      ],
    },
    hi: {
      title: 'मैसेज पर काम',
      items: [
        'मैसेज का जवाब दें, फ़ॉरवर्ड, कॉपी, एडिट, रिएक्ट और स्टार करें',
        'सबके लिए डिलीट करें, चैट पिन, म्यूट और आर्काइव करें',
      ],
    },
  },
  {
    id: 'groups',
    en: {
      title: 'Groups',
      items: [
        'Group chats with up to 256 people, admins and invite links',
        'See who has read your message in a group',
      ],
    },
    hi: {
      title: 'ग्रुप',
      items: ['256 लोगों तक के ग्रुप, एडमिन और इनवाइट लिंक', 'ग्रुप में देखें कि आपका मैसेज किसने पढ़ा'],
    },
  },
];

/** The entries in the app's language (English for anything else). */
export function whatsNewFor(language: string) {
  return WHATS_NEW.map((entry) => ({
    id: entry.id,
    ...(language === 'hi' ? entry.hi : entry.en),
  }));
}
