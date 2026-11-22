/**
 * Pure transcript merging logic.
 *
 * Fragments of the same speaker extend the current bubble.
 * A new bubble starts only after a speaker change or turn_complete.
 */

export interface TranscriptItem {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  timestamp: Date;
  isComplete?: boolean;
}

export type TranscriptMessage =
  | { type: 'user_transcription'; text: string }
  | { type: 'agent_transcription'; text: string }
  | { type: 'turn_complete'; speaker: 'user' | 'agent' }
  | { type: 'text'; text: string; sender?: 'user' };

/**
 * Joins transcript fragments into one clean string.
 *
 * Gemini streams transcription in small pieces and does not always put a space at the
 * piece boundary ('a' + 'clever', 'that' + 'introduction'), which glued words together.
 * A space is inserted when a piece starts right after a word character.
 */
export function joinFragments(fragments: string[]): string {
  let raw = '';
  for (const fragment of fragments) {
    if (!fragment) continue;
    const previous = raw.slice(-1);
    const next = fragment.charAt(0);
    if (raw && !/\s/.test(previous) && !/\s/.test(next) && /[\p{L}\p{N}]/u.test(previous) && /[\p{L}\p{N}]/u.test(next)) {
      raw += ' ';
    }
    raw += fragment;
  }
  return raw.replace(/[ \t\n\r]+/g, ' ').trim();
}

/**
 * Merges an incoming transcription fragment or turn completion message
 * into the current list of transcript items.
 */
export function mergeTranscript(
  items: TranscriptItem[],
  message: TranscriptMessage
): TranscriptItem[] {
  // 1. Explicit user typed text
  if (message.type === 'text') {
    const trimmed = message.text.trim();
    if (!trimmed) return items;
    return [
      ...items,
      {
        id: crypto.randomUUID(),
        sender: 'user',
        text: joinFragments([trimmed]),
        timestamp: new Date(),
        isComplete: true,
      },
    ];
  }

  // 2. Turn completed signal
  if (message.type === 'turn_complete') {
    if (items.length === 0) return items;
    const last = items[items.length - 1];
    if (last.sender === message.speaker && !last.isComplete) {
      return [
        ...items.slice(0, -1),
        {
          ...last,
          isComplete: true,
        },
      ];
    }
    return items;
  }

  // 3. User / Agent speech fragments
  const sender: 'user' | 'agent' =
    message.type === 'user_transcription' ? 'user' : 'agent';
  const textFragment = message.text;
  if (!textFragment || !textFragment.trim()) {
    return items;
  }

  if (items.length > 0) {
    const last = items[items.length - 1];
    // If the speaker matches and the turn was not completed, append fragment to current bubble
    if (last.sender === sender && !last.isComplete) {
      return [
        ...items.slice(0, -1),
        {
          ...last,
          text: joinFragments([last.text, textFragment]),
        },
      ];
    }
  }

  // Otherwise start a new bubble
  return [
    ...items,
    {
      id: crypto.randomUUID(),
      sender,
      text: joinFragments([textFragment]),
      timestamp: new Date(),
      isComplete: false,
    },
  ];
}
