// Row shapes for the app_state read views, used as the Props contracts for the
// presentational components. These mirror the column lists in the project brief
// (workspace.app_state.facilities and friends). Components take these shapes
// directly so screen-builders can pass a query row through with no remapping.

import type { TrustState, ClaimStatus } from './theme';

// One element of facilities.claims ARRAY<STRUCT<text,status>>.
export interface Claim {
  text: string;
  status: ClaimStatus;
}

// The 9 UI disciplines (facilities.specialties members).
export type Discipline =
  | 'Cardiology'
  | 'Nephrology'
  | 'Oncology'
  | 'Obstetrics'
  | 'Pediatrics'
  | 'Orthopedics'
  | 'Trauma'
  | 'Ophthalmology'
  | 'General Medicine';

// A single row of the app_state.facilities view (10,077 rows). Optional fields
// are those a screen may not have selected; required fields are the identity +
// trust columns every card needs.
export interface FacilityRow {
  id: string;
  name: string;
  type: string;
  city: string;
  state: string;
  lat?: number;
  lng?: number;
  specialties: string[];
  specialties_detail?: string[];
  needs?: string[];
  trust: TrustState;
  conf?: number;
  beds?: number;
  year?: number;
  capability?: string;
  procedure?: string;
  equipment?: string;
  description?: string;
  evidence?: string;
  claims?: Claim[];
  pincode?: string;
  district?: string;
  data_quality_flag?: string | null;
  possible_entity_dup?: string | null;
  id_valid?: boolean;
  coord_source?: string;
}

// One line of a FitScoreBar "why this score" breakdown.
// src tags: 'capability' | 'trust + confidence' | 'location'.
export interface FitReason {
  label: string;
  pts: number;
  src: 'capability' | 'trust + confidence' | 'location';
}
