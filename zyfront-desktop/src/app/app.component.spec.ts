/** 根组件烟测 */
import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { TeamMemorySyncService } from './core/memory/team/team-memory-sync.service';
import { RuntimeSettingsSyncService } from './core/runtime-settings-sync.service';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        {
          provide: RuntimeSettingsSyncService,
          useValue: {},
        },
        {
          provide: TeamMemorySyncService,
          useValue: { start: () => Promise.resolve() },
        },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });
});
