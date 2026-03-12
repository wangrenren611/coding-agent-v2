import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import React from 'react';

// 使 React 在全局可用
global.React = React;

// Mock ResizeObserver for Recharts
const mockResizeObserver = vi.fn(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));
vi.stubGlobal('ResizeObserver', mockResizeObserver);

// Mock IntersectionObserver
const mockIntersectionObserver = vi.fn(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));
vi.stubGlobal('IntersectionObserver', mockIntersectionObserver);

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// 清理每个测试后的 React 测试容器
afterEach(() => {
  cleanup();
});

// Mock next/server
vi.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(data), {
        ...init,
        headers: {
          'content-type': 'application/json',
          ...init?.headers,
        },
      });
    },
    error: (data: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(data), {
        ...init,
        status: init?.status || 500,
        headers: {
          'content-type': 'application/json',
          ...init?.headers,
        },
      });
    },
  },
}));

// Mock better-sqlite3
vi.mock('better-sqlite3', () => {
  const mockPrepare = vi.fn();
  const mockGet = vi.fn();
  const mockAll = vi.fn();

  class MockDatabase {
    pragma = vi.fn();
    prepare = mockPrepare;
    close = vi.fn();
  }

  return {
    default: vi.fn(() => new MockDatabase() as any),
    __mockPrepare: mockPrepare,
    __mockGet: mockGet,
    __mockAll: mockAll,
  };
});
