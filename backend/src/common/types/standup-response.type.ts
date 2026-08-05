export type StandupResponse = {
  userId: string;
  name: string;
  update: string;
  blocker?: string;
  submittedAt: string;
};

export type StandupNonResponder = {
  userId: string;
  name: string;
};