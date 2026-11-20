import { describe, it, expect } from 'vitest';
import { mergeTranscript, joinFragments, TranscriptItem } from './transcriptMerge';

describe('joinFragments', () => {
  it('joins empty array into empty string', () => {
    expect(joinFragments([])).toBe('');
  });

  it('joins fragments with leading/trailing spaces correctly', () => {
    expect(joinFragments(['Hello', ' world'])).toBe('Hello world');
    expect(joinFragments(['  leading', '  and trailing  '])).toBe('leading and trailing');
  });

  it('collapses multiple spaces and newlines', () => {
    expect(joinFragments(['word1   word2\n\nword3'])).toBe('word1 word2 word3');
  });
});

describe('mergeTranscript', () => {
  it('extends existing bubble when same speaker sends subsequent fragment', () => {
    let items: TranscriptItem[] = [];

    items = mergeTranscript(items, { type: 'user_transcription', text: 'Hello' });
    expect(items).toHaveLength(1);
    expect(items[0].sender).toBe('user');
    expect(items[0].text).toBe('Hello');
    expect(items[0].isComplete).toBe(false);

    items = mergeTranscript(items, { type: 'user_transcription', text: ' world' });
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe('Hello world');
  });

  it('starts a new bubble when speaker changes', () => {
    let items: TranscriptItem[] = [];

    items = mergeTranscript(items, { type: 'user_transcription', text: 'My answer' });
    expect(items).toHaveLength(1);

    items = mergeTranscript(items, { type: 'agent_transcription', text: 'Great point' });
    expect(items).toHaveLength(2);
    expect(items[0].sender).toBe('user');
    expect(items[1].sender).toBe('agent');
    expect(items[1].text).toBe('Great point');
  });

  it('starts a new bubble after turn_complete for the same speaker', () => {
    let items: TranscriptItem[] = [];

    items = mergeTranscript(items, { type: 'user_transcription', text: 'First sentence.' });
    items = mergeTranscript(items, { type: 'turn_complete', speaker: 'user' });
    expect(items[0].isComplete).toBe(true);

    items = mergeTranscript(items, { type: 'user_transcription', text: 'Second sentence.' });
    expect(items).toHaveLength(2);
    expect(items[0].text).toBe('First sentence.');
    expect(items[1].text).toBe('Second sentence.');
  });

  it('ignores empty fragments', () => {
    let items: TranscriptItem[] = [];
    items = mergeTranscript(items, { type: 'user_transcription', text: '   ' });
    expect(items).toHaveLength(0);
  });

  it('adds user typed text as completed item', () => {
    let items: TranscriptItem[] = [];
    items = mergeTranscript(items, { type: 'text', text: 'Typed message' });
    expect(items).toHaveLength(1);
    expect(items[0].sender).toBe('user');
    expect(items[0].text).toBe('Typed message');
    expect(items[0].isComplete).toBe(true);
  });
});
