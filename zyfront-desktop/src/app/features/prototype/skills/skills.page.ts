import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  inject,
  OnDestroy,
  signal,
} from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzInputModule } from 'ng-zorro-antd/input';
import { PrototypeCoreFacade } from '../../../shared/prototype-core.facade';
import { SkillIndexService, type SkillRecord } from '../../../core/skill-index.service';
import { SkillCreateWizardComponent } from './skill-create-wizard.component';

interface HubSkillItem {
  id: string;
  name: string;
  desc: string;
  tags: string[];
  category: '效率优化' | '开发助手' | '数据与 API';
  rating: number;
  installs: number;
  source: 'local' | 'hub';
}

interface InstalledSkillVm {
  id: string;
  name: string;
  desc: string;
  source: 'vault';
  status: 'ok' | 'invalid';
  installedAt?: number;
  updatedAt?: number;
  active: boolean;
  contentPath: string;
  scope: 'vault';
}

const SKILL_FALLBACK_ITEMS: HubSkillItem[] = [
  { id: 'skill.prompt-refine', name: '提示词优化师', desc: '结构化改写输入，提升模型响应质量。', tags: ['Prompt', 'LLM'], category: '效率优化', rating: 4.8, installs: 12400, source: 'hub' },
  { id: 'skill.test-case-agent', name: '单元测试助手', desc: '补充边界测试与失败断言。', tags: ['Testing', 'Quality'], category: '开发助手', rating: 4.6, installs: 9380, source: 'hub' },
  { id: 'skill.api-builder', name: 'API 构建大师', desc: '解析 OpenAPI 并生成调用模板。', tags: ['API', 'Docs'], category: '数据与 API', rating: 4.7, installs: 8110, source: 'hub' },
  { id: 'skill.ppt-storyboard', name: 'PPT 结构专家', desc: '主题拆分为演示页结构并支持导出。', tags: ['PPT', 'Presentation'], category: '效率优化', rating: 4.9, installs: 10500, source: 'hub' },
];

@Component({
  selector: 'app-skills-page',
  standalone: true,
  imports: [NgFor, NgIf, NzButtonModule, NzTagModule, NzInputModule, RouterLink, RouterLinkActive, SkillCreateWizardComponent],
  templateUrl: './skills.page.html',
  styleUrls: ['../prototype-page.scss', './skills.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SkillsPrototypePageComponent implements OnDestroy {
  private readonly cdr = inject(ChangeDetectorRef);
  protected readonly facade = inject(PrototypeCoreFacade);
  private readonly skillIndex = inject(SkillIndexService);
  private readonly unwatchSkillDir = this.skillIndex.watchVaultSkillRoot(() => {
    void this.refreshLocalSkillMarket();
  });

  protected readonly createMode = signal(false);
  protected readonly hubQuery = signal('');
  protected readonly loadingHub = signal(false);
  protected readonly hubError = signal('');
  protected readonly installingHubIds = signal<Record<string, boolean>>({});
  protected readonly activeCategory = signal<'全部' | HubSkillItem['category']>('全部');

  protected readonly hubSkills = signal<HubSkillItem[]>(SKILL_FALLBACK_ITEMS);
  protected readonly installedSkills = signal<InstalledSkillVm[]>([]);
  protected readonly selectedHubSkillId = signal(SKILL_FALLBACK_ITEMS[0]?.id ?? '');

  protected readonly skillPreview = signal('');
  protected readonly testInput = signal('请把“本项目季度进展”整理成 5 页演示结构，并给出每页标题。');
  protected readonly testOutput = signal('');
  protected readonly testingSkill = signal(false);

  protected readonly activeSkill = computed(() => {
    const skills = this.facade.skills();
    return (skills.find((s: { active: boolean }) => s.active) ?? skills[0])!;
  });

  protected readonly categories = computed(() => {
    const all = this.hubSkills();
    const count = (name: '全部' | HubSkillItem['category']) =>
      name === '全部' ? all.length : all.filter((x) => x.category === name).length;
    return [
      { key: '全部' as const, label: `全部技能 (${count('全部')})` },
      { key: '效率优化' as const, label: `效率优化 (${count('效率优化')})` },
      { key: '开发助手' as const, label: `开发助手 (${count('开发助手')})` },
      { key: '数据与 API' as const, label: `数据与 API (${count('数据与 API')})` },
    ];
  });

  protected readonly filteredHubSkills = computed(() => {
    const q = this.hubQuery().trim().toLowerCase();
    const cat = this.activeCategory();

    return this.hubSkills().filter((it) => {
      const inCat = cat === '全部' || it.category === cat;
      const inSearch = !q || `${it.id} ${it.name} ${it.desc} ${it.tags.join(' ')} ${it.source}`.toLowerCase().includes(q);
      return inCat && inSearch;
    });
  });

  protected readonly selectedHubSkill = computed(() => {
    const id = this.selectedHubSkillId();
    return this.hubSkills().find((x) => x.id === id) ?? this.filteredHubSkills()[0] ?? null;
  });

  constructor() {
    void this.refreshHubSkills();
    const first = this.selectedHubSkillId();
    if (first) void this.loadSkillPreview(first);
  }

  ngOnDestroy(): void {
    this.unwatchSkillDir();
  }

  openCreateWizard(): void {
    this.createMode.set(true);
    this.cdr.markForCheck();
  }

  closeCreateWizard(): void {
    this.createMode.set(false);
    this.cdr.markForCheck();
  }

  completeCreateWizard(payload: { name: string; desc: string }): void {
    this.facade.addSkill({ ...payload, outputMode: 'standard' });
    this.createMode.set(false);
    this.cdr.markForCheck();
  }

  protected setCategory(cat: '全部' | HubSkillItem['category']): void {
    this.activeCategory.set(cat);
  }

  protected selectHubSkill(item: HubSkillItem): void {
    this.selectedHubSkillId.set(item.id);
    void this.loadSkillPreview(item.id);
  }

  protected isHubSkillInstalled(id: string): boolean {
    return this.installedSkills().some((s) => s.id === id) || this.facade.skills().some((s) => s.id === id);
  }

  protected async refreshHubSkills(): Promise<void> {
    const q = this.hubQuery().trim() || 'productivity';
    this.loadingHub.set(true);
    this.hubError.set('');

    try {
      await this.refreshInstalledSkills();
      const local = this.loadLocalSkillsFromIndex();
      if (!local.length) {
        this.hubError.set('未发现已安装技能：请在 Vault 的 `03-AGENT-TOOLS/01-Skills/<技能ID>/SKILL.md`（或模型页配置的技能根）维护技能。');
      }
      const remote = await this.loadRemoteSkills(q);

      const merged = this.mergeSkills(local, remote.length ? remote : SKILL_FALLBACK_ITEMS);
      this.hubSkills.set(merged);

      if (!merged.find((x) => x.id === this.selectedHubSkillId())) {
        this.selectedHubSkillId.set(merged[0]?.id ?? '');
      }
      if (this.selectedHubSkillId()) void this.loadSkillPreview(this.selectedHubSkillId());
    } catch (e) {
      this.hubError.set(e instanceof Error ? e.message : '加载技能失败');
      this.hubSkills.set(SKILL_FALLBACK_ITEMS);
    } finally {
      this.loadingHub.set(false);
    }
  }

  protected async installHubSkill(skill: HubSkillItem): Promise<void> {
    if (this.isHubSkillInstalled(skill.id)) return;
    this.installingHubIds.update((m) => ({ ...m, [skill.id]: true }));
    this.hubError.set('');

    try {
      if (skill.source === 'local') {
        this.facade.installSkillFromHub({ id: skill.id, name: skill.name, desc: skill.desc });
        return;
      }

      const cmd = `clawhub install ${this.escapeArg(skill.id)} --no-input`;
      const run = await window.zytrader.terminal.exec(cmd, '.');
      const out = `${run.stdout ?? ''}\n${run.stderr ?? ''}`.trim();
      if (!run.ok) {
        throw new Error(out || '安装失败');
      }

      await this.refreshHubSkills();
      this.facade.installSkillFromHub({ id: skill.id, name: skill.name, desc: skill.desc });
    } catch (e) {
      this.hubError.set(e instanceof Error ? e.message : '安装失败');
    } finally {
      this.installingHubIds.update((m) => {
        const next = { ...m };
        delete next[skill.id];
        return next;
      });
    }
  }

  protected async runSkillTest(skill: HubSkillItem | null): Promise<void> {
    if (!skill) return;
    this.testingSkill.set(true);
    this.testOutput.set('');

    try {
      const installed = this.isHubSkillInstalled(skill.id);
      if (!installed) {
        this.testOutput.set('请先安装该技能，再执行测试。');
        return;
      }

      const prompt = this.testInput().trim() || '请生成一个简短的技能执行示例。';
      const installedRec = this.installedSkills().find((x) => x.id === skill.id);
      const md = installedRec
        ? await this.skillIndex.readSkillMd({ contentPath: installedRec.contentPath, scope: installedRec.scope })
        : { ok: false, content: '' };
      const skillContent = md.ok ? md.content : `# ${skill.name}\n\n${skill.desc}`;

      const agentResult = await this.facade.runSkillWithAgent({
        skillId: skill.id,
        skillContent,
        prompt,
      });

      const output = [
        `技能：${skill.name}`,
        `技能ID：${skill.id}`,
        `输入：${prompt}`,
        '',
        'Agent 实际运行结果：',
        agentResult,
      ].join('\n');

      this.testOutput.set(output);
    } finally {
      this.testingSkill.set(false);
    }
  }

  private async refreshInstalledSkills(): Promise<void> {
    const records = await this.skillIndex.listInstalledSkills();
    const activeId = this.facade.skills().find((x) => x.active)?.id;

    const vm = records.map((r) => this.toInstalledVm(r, activeId));
    this.installedSkills.set(vm);
    this.syncFacadeWithInstalled(vm);
  }

  private loadLocalSkillsFromIndex(): HubSkillItem[] {
    return this.installedSkills()
      .filter((x) => x.status !== 'invalid')
      .map((x) => ({
        id: x.id,
        name: x.name,
        desc: x.desc,
        tags: ['Vault', ...this.guessTags(x.id, x.desc)].slice(0, 3),
        category: this.guessCategory(x.id, x.desc),
        rating: 5.0,
        installs: 0,
        source: 'local' as const,
      }));
  }

  /** 目录 watcher 触发：只重扫 Vault 技能并合并进当前市场列表，不打远程 clawhub */
  private async refreshLocalSkillMarket(): Promise<void> {
    await this.refreshInstalledSkills();
    const local = this.loadLocalSkillsFromIndex();
    this.hubSkills.update((cur) => {
      const remote = cur.filter((x) => x.source !== 'local');
      return this.mergeSkills(local, remote);
    });
    const sel = this.selectedHubSkillId();
    if (sel) void this.loadSkillPreview(sel);
    this.cdr.markForCheck();
  }

  private toInstalledVm(record: SkillRecord, activeId?: string): InstalledSkillVm {
    return {
      id: record.id,
      name: record.name,
      desc: record.desc,
      source: record.source,
      status: record.status,
      installedAt: record.installedAt,
      updatedAt: record.updatedAt,
      active: activeId ? activeId === record.id : false,
      contentPath: record.contentPath,
      scope: record.scope,
    };
  }

  private syncFacadeWithInstalled(installed: InstalledSkillVm[]): void {
    for (const it of installed) {
      if (!this.facade.skills().some((s) => s.id === it.id)) {
        this.facade.installSkillFromHub({
          id: it.id,
          name: it.name,
          desc: it.desc,
          source: it.source,
          status: it.status,
          installedAt: it.installedAt,
          updatedAt: it.updatedAt,
          activate: false,
        });
      }
    }
  }

  private async loadSkillPreview(skillId: string): Promise<void> {
    const rec = this.installedSkills().find((x) => x.id === skillId);
    if (rec) {
      const read = await this.skillIndex.readSkillMd({ contentPath: rec.contentPath, scope: rec.scope });
      if (read.ok) {
        this.skillPreview.set(read.content.slice(0, 12000));
        return;
      }
    }

    const hub = this.hubSkills().find((x) => x.id === skillId);
    if (hub) {
      this.skillPreview.set(`# ${hub.name}\n\n${hub.desc}\n\n> 该技能当前无本地 SKILL.md，安装后可预览本地规则文件。`);
    } else {
      this.skillPreview.set('未找到技能预览内容。');
    }
  }

  private async loadRemoteSkills(query: string): Promise<HubSkillItem[]> {
    const primary = await window.zytrader.terminal.exec(`clawhub search "${this.escapeArg(query)}" --limit 24`, '.');
    let text = `${primary.stdout ?? ''}\n${primary.stderr ?? ''}`.trim();

    if (!primary.ok || /not recognized|not found|command not found|不是内部或外部命令/i.test(text)) {
      const fallback = await window.zytrader.terminal.exec(`openclaw skills search "${this.escapeArg(query)}"`, '.');
      text = `${fallback.stdout ?? ''}\n${fallback.stderr ?? ''}`.trim();
      if (!fallback.ok) return [];
    }

    return this.parseSearchOutput(text);
  }

  private mergeSkills(local: HubSkillItem[], remote: HubSkillItem[]): HubSkillItem[] {
    const map = new Map<string, HubSkillItem>();
    for (const x of remote) map.set(x.id, x);
    for (const x of local) map.set(x.id, x);
    return [...map.values()];
  }

  private parseSearchOutput(text: string): HubSkillItem[] {
    const lines = text
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)
      .filter((x) => !/^search results|^found\s+\d+/i.test(x));

    const out: HubSkillItem[] = [];
    for (const line of lines) {
      const m = line.match(/^([a-zA-Z0-9._/-]{2,})\s*(?:-|\||:)\s*(.+)$/);
      if (!m) continue;
      const id = m[1].trim();
      const desc = m[2].trim();
      out.push({
        id,
        name: this.prettyNameFromId(id),
        desc,
        tags: this.guessTags(id, desc),
        category: this.guessCategory(id, desc),
        rating: this.scoreFromId(id),
        installs: 3000 + Math.floor(Math.random() * 11000),
        source: 'hub',
      });
    }

    const uniq = new Map<string, HubSkillItem>();
    for (const it of out) if (!uniq.has(it.id)) uniq.set(it.id, it);
    return [...uniq.values()].slice(0, 24);
  }

  private guessCategory(id: string, desc: string): HubSkillItem['category'] {
    const src = `${id} ${desc}`.toLowerCase();
    if (src.includes('api') || src.includes('data') || src.includes('sql')) return '数据与 API';
    if (src.includes('refactor') || src.includes('test') || src.includes('code')) return '开发助手';
    return '效率优化';
  }

  private scoreFromId(id: string): number {
    const n = id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    return 4.2 + (n % 8) / 10;
  }

  private prettyNameFromId(id: string): string {
    const last = id.split('/').pop() ?? id;
    return last.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
  }

  private guessTags(id: string, desc: string): string[] {
    const src = `${id} ${desc}`.toLowerCase();
    const tags: string[] = [];
    if (src.includes('ppt')) tags.push('PPT');
    if (src.includes('test')) tags.push('Testing');
    if (src.includes('refactor')) tags.push('Refactor');
    if (src.includes('api')) tags.push('API');
    if (!tags.length) tags.push('General');
    return tags.slice(0, 3);
  }

  protected formatInstalledMeta(item: InstalledSkillVm): string {
    const status = item.status === 'invalid' ? '无效' : '正常';
    return `Vault 技能根 · ${status}`;
  }

  private escapeArg(raw: string): string {
    return String(raw).replace(/"/g, '\\"');
  }
}
