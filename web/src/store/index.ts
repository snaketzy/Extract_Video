import { configureStore } from '@reduxjs/toolkit';

import mediaReducer from '@/store/mediaSlice';

export const store = configureStore({
  reducer: {
    media: mediaReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
