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
        create: (payload: { id: string; cwd?: string; cols?: number; rows?: number; shell?: 'powershell' | 'git-bash' | 'cmd' | 'bash' | 'zsh' }) => Promise<{ ok: boolean; id?: string; error?: string }>;
        write: (payload: { id: string; data: string }) => Promise<{ ok: boolean; error?: string }>;
        resize: (payload: { id: string; cols: number; rows: number }) => Promise<{ ok: boolean; error?: string }>;
        kill: (payload: { id: string }) => Promise<{ ok: boolean; error?: string }>;
        onData: (callback: (payload: { id: string; data: string }) => void) => () => void;
        onExit: (callback: (payload: { id: string; exitCode: number; signal: number }) => void) => () => void;
      };
      model: {
        test: (payload: { baseUrl: string; apiKey: string; model: string; provider?: string }) => Promise<{ ok: boolean; status: number; body: string }>;
      };
      workspace: {
        info: () => Promise<{ ok: boolean; root: string; exists: boolean }>;
      };
      host: {
        openPath: (targetPath: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
      };
    };
  }
}
