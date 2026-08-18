import { afterEach, describe, expect, test } from 'bun:test';
import { isAllowedSourceUrl } from './source-url';

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

describe('isAllowedSourceUrl', () => {
  test('accepts public HTTPS URLs without embedded credentials', () => {
    expect(isAllowedSourceUrl('https://cdn.example/video.mp4')).toBe(true);
    expect(isAllowedSourceUrl('https://user:pass@cdn.example/video.mp4')).toBe(false);
  });

  test('rejects insecure remote URLs in production', () => {
    process.env.NODE_ENV = 'production';
    expect(isAllowedSourceUrl('http://cdn.example/video.mp4')).toBe(false);
    expect(isAllowedSourceUrl('file:///etc/passwd')).toBe(false);
  });

  test('allows local HTTP only for development', () => {
    process.env.NODE_ENV = 'development';
    expect(isAllowedSourceUrl('http://localhost:9000/video.mp4')).toBe(true);
    expect(isAllowedSourceUrl('http://192.168.1.10/video.mp4')).toBe(false);
  });
});
