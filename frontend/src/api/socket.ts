/**
 * socket.ts — Socket.IO client factory (Phase 1b auth 2026-06-07).
 *
 * Mọi composable tạo socket QUA đây để JWT được gắn vào handshake một chỗ
 * duy nhất (DRY). Token đọc động qua callback → khi reconnect lấy token mới
 * (quan trọng cho access token ngắn hạn + refresh rotation ở Phase 2).
 *
 * Backend (socket-auth.ts) verify token này và auto-join org room từ token,
 * nên FE KHÔNG cần emit('org:join') nữa.
 */
import { io, type Socket } from 'socket.io-client';

export function createAppSocket(): Socket {
  return io({
    transports: ['websocket', 'polling'],
    auth: (cb: (data: { token: string }) => void) =>
      cb({ token: localStorage.getItem('token') ?? '' }),
  });
}
