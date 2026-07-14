import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

interface ContactFormData {
  name: string;
  email: string;
  subject: string;
  message: string;
}

interface ContactResponse {
  success: boolean;
  message?: string;
  error?: string;
}

@Injectable({
  providedIn: 'root',
})
export class ContactService {
  private base = 'https://coderefresherworker.manavnanda2404.workers.dev';
  private apiUrl = `${this.base}/api/contact`;
  private http = inject(HttpClient);

  constructor() {}

  submitContactForm(formData: ContactFormData): Observable<ContactResponse> {
    return this.http.post<ContactResponse>(this.apiUrl, formData);
  }
}
