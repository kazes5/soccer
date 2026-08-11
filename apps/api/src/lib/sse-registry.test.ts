import { describe, expect, it, vi } from 'vitest';
import { SseRegistry } from './sse-registry';

describe('SseRegistry', () => {
  it('dispatches only to connections matching both team and recipient user id', () => {
    const registry = new SseRegistry();
    const matching = vi.fn();
    const wrongUser = vi.fn();
    const wrongTeam = vi.fn();

    registry.add({ id: 'conn-1', userId: 'user-1', teamId: 'team-1' }, matching);
    registry.add({ id: 'conn-2', userId: 'user-2', teamId: 'team-1' }, wrongUser);
    registry.add({ id: 'conn-3', userId: 'user-1', teamId: 'team-2' }, wrongTeam);

    registry.dispatch('team-1', ['user-1']);

    expect(matching).toHaveBeenCalledOnce();
    expect(wrongUser).not.toHaveBeenCalled();
    expect(wrongTeam).not.toHaveBeenCalled();
  });

  it('dispatches to every connection for a broadcast with multiple recipients', () => {
    const registry = new SseRegistry();
    const first = vi.fn();
    const second = vi.fn();

    registry.add({ id: 'conn-1', userId: 'user-1', teamId: 'team-1' }, first);
    registry.add({ id: 'conn-2', userId: 'user-2', teamId: 'team-1' }, second);

    registry.dispatch('team-1', ['user-1', 'user-2']);

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it('stops dispatching to a removed connection', () => {
    const registry = new SseRegistry();
    const callback = vi.fn();
    registry.add({ id: 'conn-1', userId: 'user-1', teamId: 'team-1' }, callback);

    registry.remove('conn-1');
    registry.dispatch('team-1', ['user-1']);

    expect(callback).not.toHaveBeenCalled();
    expect(registry.size).toBe(0);
  });

  it('tracks connection count via size', () => {
    const registry = new SseRegistry();
    expect(registry.size).toBe(0);

    registry.add({ id: 'conn-1', userId: 'user-1', teamId: 'team-1' }, () => {});
    registry.add({ id: 'conn-2', userId: 'user-2', teamId: 'team-1' }, () => {});
    expect(registry.size).toBe(2);

    registry.remove('conn-1');
    expect(registry.size).toBe(1);
  });
});
