import { TestBed } from '@angular/core/testing';
import { SnapshotService } from './snapshot.service';

describe('SnapshotService', () => {
  let service: SnapshotService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SnapshotService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should create and manage snapshots', () => {
    const initialCount = service.snapshots().length;
    const testState = { test: 'data' };
    service.createSnapshot(testState, '测试快照');
    expect(service.snapshots().length).toBe(initialCount + 1);
  });

  it('should retrieve snapshot by id', () => {
    const testState = { test: 'data' };
    const snapshot = service.createSnapshot(testState, '测试快照');
    const retrieved = service.getSnapshotById(snapshot.id);
    expect(retrieved).toBeTruthy();
    expect(retrieved?.state).toEqual(testState);
  });
});
