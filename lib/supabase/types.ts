export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          display_name: string | null;
          timezone: string;
          issue_number: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          display_name?: string | null;
          timezone?: string;
          issue_number?: number;
        };
        Update: {
          display_name?: string | null;
          timezone?: string;
          issue_number?: number;
          updated_at?: string;
        };
      };
      connections: {
        Row: {
          id: string;
          user_id: string;
          service: 'spotify' | 'deezer';
          access_token: string;
          refresh_token: string | null;
          expires_at: string | null;
          service_user_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          service: 'spotify' | 'deezer';
          access_token: string;
          refresh_token?: string | null;
          expires_at?: string | null;
          service_user_id?: string | null;
        };
        Update: {
          access_token?: string;
          refresh_token?: string | null;
          expires_at?: string | null;
          updated_at?: string;
        };
      };
      daily_issues: {
        Row: {
          id: string;
          user_id: string;
          issue_number: number;
          sections: DailySection[];
          dj_intro: string;
          dj_teaser: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          issue_number: number;
          sections: DailySection[];
          dj_intro: string;
          dj_teaser: string;
        };
        Update: never;
      };
    };
  };
}

export interface DailySection {
  id: string;
  label: string;
  tagline: string;
  tracks: DailyTrack[];
  playlist_url?: string;
}

export interface DailyTrack {
  id: string;
  name: string;
  artist: string;
  album: string;
  image_url: string;
  external_url: string;
  uri: string;
}
