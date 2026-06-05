import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { RefresherData } from '../models/refresher-item.model';

@Injectable({ providedIn: 'root' })
export class DataService {
  private http = inject(HttpClient);

  loadData(tech: string): Observable<RefresherData> {
    return this.http.get<RefresherData>(`data/${tech}.json`);
  }
}
