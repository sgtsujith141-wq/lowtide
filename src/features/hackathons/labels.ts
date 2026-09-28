import type {
  BuildStatus,
  HackathonStatus,
  PptStatus,
  RegistrationStatus,
} from '../../types/domain';

export const STATUS_LABEL: Record<HackathonStatus, string> = {
  considering: 'Considering',
  active: 'Active',
  finished: 'Finished',
  dropped: 'Dropped',
};

export const REGISTRATION_LABEL: Record<RegistrationStatus, string> = {
  not_registered: 'Not registered',
  registered: 'Registered',
  waitlisted: 'Waitlisted',
  rejected: 'Not selected',
};

export const PPT_LABEL: Record<PptStatus, string> = {
  not_needed: 'Not needed',
  not_started: 'Not started',
  in_progress: 'In progress',
  submitted: 'Submitted',
};

export const BUILD_LABEL: Record<BuildStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  demo_ready: 'Demo ready',
  submitted: 'Submitted',
};
