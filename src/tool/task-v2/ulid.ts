const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeBase32(value: number, length: number): string {
  let out = '';
  let current = value;
  for (let i = 0; i < length; i += 1) {
    out = ENCODING[current % 32] + out;
    current = Math.floor(current / 32);
  }
  return out;
}

function randomBase32(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    const idx = Math.floor(Math.random() * 32);
    out += ENCODING[idx];
  }
  return out;
}

export function createUlidLike(): string {
  const time = Date.now();
  const timePart = encodeBase32(time, 10);
  const randomPart = randomBase32(16);
  return `${timePart}${randomPart}`;
}

export function createTaskId(): `tsk_${string}` {
  return `tsk_${createUlidLike()}`;
}

export function createRunId(): `run_${string}` {
  return `run_${createUlidLike()}`;
}
