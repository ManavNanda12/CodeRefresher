import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterModule } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { SeoService } from '../../core/services/seo.service';
import { ContactService } from '../../services/contact-service/contact.service';

interface ContactForm {
  name: string;
  email: string;
  subject: string;
  message: string;
}

@Component({
  selector: 'app-contact',
  imports: [CommonModule, RouterModule, ReactiveFormsModule],
  templateUrl: './contact.html',
  styleUrl: './contact.css',
})
export class ContactComponent {
  private fb = inject(FormBuilder);
  private contactService = inject(ContactService);
  private seo = inject(SeoService);

  contactForm: FormGroup;
  submitting = signal(false);
  submitted = signal(false);
  error = signal('');
  success = signal(false);

  constructor() {
    this.seo.update({
      title: 'Contact Us — Send Feedback & Suggestions',
      description: 'Have a suggestion, bug report, or question? Send us a message and help make CodeRefresher better.',
      keywords: 'contact, feedback, suggestions, bug report, support',
      noindex: true,
    });

    this.contactForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      subject: ['', [Validators.required, Validators.minLength(3)]],
      message: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(2000)]],
    });
  }

  onSubmit(): void {
    if (this.contactForm.invalid || this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.error.set('');

    const formData = this.contactForm.value;

    this.contactService.submitContactForm(formData).subscribe({
      next: (response) => {
        this.submitting.set(false);
        if (response.success) {
          this.success.set(true);
          this.contactForm.reset();
        } else {
          this.error.set(response.error || 'Failed to send message. Please try again later.');
        }
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(
          err.status === 429
            ? 'Too many messages. Please wait a moment before trying again.'
            : 'Failed to send message. Please try again later.'
        );
      },
    });
  }

  contactFormProperty(fieldName: string) {
    return this.contactForm.get(fieldName);
  }
}
