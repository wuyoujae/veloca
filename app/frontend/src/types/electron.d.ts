export {};

declare global {
  interface Window {
    veloca?: {
      settings: {
        getTheme: () => Promise<'dark' | 'light'>;
        setTheme: (theme: 'dark' | 'light') => Promise<'dark' | 'light'>;
      };
      app: {
        platform: NodeJS.Platform;
      };
    };
  }
}
