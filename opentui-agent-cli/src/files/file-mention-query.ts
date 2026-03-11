export type FileMentionMatch = {
  token: string;
  query: string;
  start: number;
  end: number;
};

const FILE_MENTION_PATTERN = /(^|\s)(@\/[^\s]*)$/;

export const findTrailingFileMention = (value: string): FileMentionMatch | null => {
  const match = value.match(FILE_MENTION_PATTERN);
  const token = match?.[2];
  if (!token) {
    return null;
  }

  const start = value.length - token.length;
  return {
    token,
    query: token.slice(2),
    start,
    end: value.length,
  };
};

export const removeTrailingFileMention = (value: string): string => {
  const match = findTrailingFileMention(value);
  if (!match) {
    return value;
  }
  return value.slice(0, match.start);
};
