import { client } from './client';

export interface NotificationSettings {
  trade:     boolean;
  bigProfit: boolean;
  bigLoss:   boolean;
  weekly:    boolean;
  deposit:   boolean;
}

export const notificationsService = {
  getSettings: () =>
    client.get<NotificationSettings>('/notifications/settings'),

  updateSettings: (body: Partial<NotificationSettings>) =>
    client.patch<NotificationSettings>('/notifications/settings', body),
};
