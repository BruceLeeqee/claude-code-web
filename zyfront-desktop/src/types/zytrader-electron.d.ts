export {}

declare global {
  interface Window {
    zytrader: {
      fs: {
        list: (dir?: string) => Promise<{ ok: boolean; dir: string; entries: Array<{ name: string; type: 'dir' | 'file' }> }>;
        read: (filePath: string) => Promise<{ ok: boolean; path: string; content: string }>;
        write: (filePath: string, content: string) => Promise<{ ok: boolean; path: string }>;
        remove: (targetPath: string) => Promise<{ ok: boolean; path: string }>;
      };
      terminal: {
        exec: (command: string, cwd?: string) => Promise<{ ok: boolean; command: string; cwd: string; code: number; stdout: string; stderr: string }>;
      };
      model: {
        test: (payload: { baseUrl: string; apiKey: string; model: string; provider?: string }) => Promise<{ ok: boolean; status: number; body: string }>;
      };
      workspace: {
        info: () => Promise<{ ok: boolean; root: string; exists: boolean }>;
      };
    };
  }
}
