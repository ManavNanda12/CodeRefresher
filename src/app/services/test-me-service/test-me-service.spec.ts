import { TestBed } from '@angular/core/testing';

import { TestMeService } from './test-me-service';

describe('TestMeService', () => {
  let service: TestMeService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TestMeService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
