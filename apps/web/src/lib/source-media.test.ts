import { describe, expect, test } from 'bun:test';
import { isUnsupportedMediaPageUrl, readableSourceBytes, sourceContentType } from './source-media';

describe('source media submission helpers', () => {
  test('uses the browser-provided MIME type when one is available', () => {
    expect(sourceContentType({ name: 'episode.bin', type: 'video/webm' })).toBe('video/webm');
  });

  test('recovers supported MIME types from file extensions when the browser omits one', () => {
    expect(sourceContentType({ name: 'Episode.01.MKV', type: '' })).toBe('video/x-matroska');
    expect(sourceContentType({ name: 'dialogue.flac', type: '' })).toBe('audio/flac');
    expect(sourceContentType({ name: 'notes.txt', type: '' })).toBe('');
  });

  test('formats source file sizes for the upload field', () => {
    expect(readableSourceBytes(512)).toBe('1 KB');
    expect(readableSourceBytes(1_572_864)).toBe('1.5 MB');
    expect(readableSourceBytes(150 * 1024 * 1024)).toBe('150 MB');
  });

  test('identifies video-host pages that cannot be downloaded as raw media', () => {
    expect(isUnsupportedMediaPageUrl('https://youtu.be/abc123')).toBe(true);
    expect(isUnsupportedMediaPageUrl('https://www.youtube.com/watch?v=abc123')).toBe(true);
    expect(isUnsupportedMediaPageUrl('https://player.vimeo.com/video/123')).toBe(true);
  });

  test('does not reject direct media or lookalike domains', () => {
    expect(isUnsupportedMediaPageUrl('https://media.example.com/episode.mkv')).toBe(false);
    expect(isUnsupportedMediaPageUrl('https://notyoutube.com/episode.mp4')).toBe(false);
    expect(isUnsupportedMediaPageUrl('not a url')).toBe(false);
  });
});
