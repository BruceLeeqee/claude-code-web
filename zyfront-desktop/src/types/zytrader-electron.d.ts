export {}

export type ZytraderFsScope = 'workspace' | 'vault'

export type ZytraderCwdScope = 'workspace' | 'vault'

export type ZytraderVaultMode = 'nested' | 'global'

export interface ZytraderVaultPartialConfig {
  mode?: ZytraderVaultMode
  nestedRelative?: string
  globalRoot?: string
  projectKey?: string
}

export interface WorkspaceInfoOk {
  ok: true
  root: string
  exists: boolean
  vaultRoot: string
  vaultMode: ZytraderVaultMode
  vaultConfigured: boolean
  projectKey: string
  workspaceFromEnv: boolean
}

declare global {
  interface Window {
    zytrader: {
      fs: {
        list: (
          dir?: string,
          opts?: { scope?: ZytraderFsScope },
        ) => Promise<{
          ok: boolean
          dir: string
          scope?: ZytraderFsScope
          entries: Array<{ name: string; type: 'dir' | 'file' }>
        }>
        read: (
          filePath: string,
          opts?: { scope?: ZytraderFsScope },
        ) => Promise<{ ok: boolean; path: string; scope?: ZytraderFsScope; content: string }>
        write: (
          filePath: string,
          content: string,
          opts?: { scope?: ZytraderFsScope },
        ) => Promise<{ ok: boolean; path: string; scope?: ZytraderFsScope }>
        remove: (
          targetPath: string,
          opts?: { scope?: ZytraderFsScope },
        ) => Promise<{ ok: boolean; path: string; scope?: ZytraderFsScope }>
      }
      terminal: {
        exec: (
          command: string,
          cwd?: string,
          cwdScope?: ZytraderCwdScope,
        ) => Promise<{
          ok: boolean
          command: string
          cwd: string
          cwdScope?: ZytraderCwdScope
          code: number
          stdout: string
          stderr: string
        }>
        create: (payload: {
          id: string
          cwd?: string
          cwdScope?: ZytraderCwdScope
          cols?: number
          rows?: number
          shell?: 'powershell' | 'git-bash' | 'cmd' | 'bash' | 'zsh'
        }) => Promise<{ ok: boolean; id?: string; error?: string }>
        write: (payload: { id: string; data: string }) => Promise<{ ok: boolean; error?: string }>
        resize: (payload: { id: string; cols: number; rows: number }) => Promise<{ ok: boolean; error?: string }>
        kill: (payload: { id: string }) => Promise<{ ok: boolean; error?: string }>
        onData: (callback: (payload: { id: string; data: string }) => void) => () => void
        onExit: (callback: (payload: { id: string; exitCode: number; signal: number }) => void) => () => void
      }
      model: {
        test: (payload: { baseUrl: string; apiKey: string; model: string; provider?: string }) => Promise<{
          ok: boolean
          status: number
          body: string
        }>
      }
      workspace: {
        info: () => Promise<WorkspaceInfoOk | { ok: false; error?: string }>
        setRoot: (dir: string) => Promise<{ ok: boolean; root?: string; vaultRoot?: string; error?: string }>
        pickRoot: () => Promise<WorkspaceInfoOk | { ok: false; canceled?: boolean; error?: string }>
      }
      vault: {
        bootstrap: () => Promise<{ ok: boolean; vaultRoot?: string; error?: string }>
        resolve: (key: string) => Promise<{ ok: boolean; key?: string; relative?: string; absolute?: string; error?: string }>
        setConfig: (partial: ZytraderVaultPartialConfig) => Promise<{
          ok: boolean
          vault?: ZytraderVaultPartialConfig
          vaultRoot?: string
          error?: string
        }>
      }
      host: {
        openPath: (
          targetPath: string,
          opts?: { scope?: ZytraderFsScope },
        ) => Promise<{ ok: boolean; path?: string; error?: string }>
      }
    }
  }
}
