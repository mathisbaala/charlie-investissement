export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      charlie_dossier: {
        Row: {
          access_token: string
          cabinet_id: string | null
          created_at: string
          data: Json
          expires_at: string
          id: string
          steps_completed: string[]
          updated_at: string
        }
        Insert: {
          access_token: string
          cabinet_id?: string | null
          created_at?: string
          data: Json
          expires_at?: string
          id?: string
          steps_completed?: string[]
          updated_at?: string
        }
        Update: {
          access_token?: string
          cabinet_id?: string | null
          created_at?: string
          data?: Json
          expires_at?: string
          id?: string
          steps_completed?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      database_billing_accounts: {
        Row: {
          created_at: string
          current_period_end_ms: number | null
          email: string
          first_name: string | null
          id: string
          last_name: string | null
          last_seen_at: string
          profession: string | null
          sid: string | null
          status: string
          stripe_customer_id: string
          subscription_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_period_end_ms?: number | null
          email?: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          last_seen_at?: string
          profession?: string | null
          sid?: string | null
          status?: string
          stripe_customer_id: string
          subscription_id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_period_end_ms?: number | null
          email?: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          last_seen_at?: string
          profession?: string | null
          sid?: string | null
          status?: string
          stripe_customer_id?: string
          subscription_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      database_billing_credit_events: {
        Row: {
          credits_granted: number
          email: string | null
          event_source: string
          first_name: string | null
          id: string
          last_name: string | null
          metadata: Json
          occurred_at: string
          payment_status: string
          profession: string | null
          sid: string | null
          stripe_checkout_session_id: string
          stripe_customer_id: string
        }
        Insert: {
          credits_granted: number
          email?: string | null
          event_source: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          metadata?: Json
          occurred_at?: string
          payment_status: string
          profession?: string | null
          sid?: string | null
          stripe_checkout_session_id: string
          stripe_customer_id: string
        }
        Update: {
          credits_granted?: number
          email?: string | null
          event_source?: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          metadata?: Json
          occurred_at?: string
          payment_status?: string
          profession?: string | null
          sid?: string | null
          stripe_checkout_session_id?: string
          stripe_customer_id?: string
        }
        Relationships: []
      }
      database_billing_paywall_events: {
        Row: {
          email: string | null
          event_type: string
          id: string
          metadata: Json
          occurred_at: string
          route: string | null
          sid: string | null
          stripe_customer_id: string | null
        }
        Insert: {
          email?: string | null
          event_type: string
          id?: string
          metadata?: Json
          occurred_at?: string
          route?: string | null
          sid?: string | null
          stripe_customer_id?: string | null
        }
        Update: {
          email?: string | null
          event_type?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          route?: string | null
          sid?: string | null
          stripe_customer_id?: string | null
        }
        Relationships: []
      }
      dexter_anonymous_sessions: {
        Row: {
          anonymous_id: string
          created_at_ms: number
          fingerprint_hash: string | null
          ip_prefix: string | null
          last_seen_ms: number
          migrated_to_user_id: string | null
          trial_limit: number
          trial_used: number
          trial_window_start_ms: number
        }
        Insert: {
          anonymous_id: string
          created_at_ms: number
          fingerprint_hash?: string | null
          ip_prefix?: string | null
          last_seen_ms: number
          migrated_to_user_id?: string | null
          trial_limit?: number
          trial_used?: number
          trial_window_start_ms: number
        }
        Update: {
          anonymous_id?: string
          created_at_ms?: number
          fingerprint_hash?: string | null
          ip_prefix?: string | null
          last_seen_ms?: number
          migrated_to_user_id?: string | null
          trial_limit?: number
          trial_used?: number
          trial_window_start_ms?: number
        }
        Relationships: []
      }
      dexter_checkout_sessions: {
        Row: {
          amount_cents: number
          created_at_ms: number
          credits: number
          currency: string
          email: string | null
          fulfilled_at_ms: number | null
          owner_id: string
          owner_type: string
          status: string
          stripe_session_id: string
        }
        Insert: {
          amount_cents: number
          created_at_ms: number
          credits: number
          currency: string
          email?: string | null
          fulfilled_at_ms?: number | null
          owner_id: string
          owner_type: string
          status: string
          stripe_session_id: string
        }
        Update: {
          amount_cents?: number
          created_at_ms?: number
          credits?: number
          currency?: string
          email?: string | null
          fulfilled_at_ms?: number | null
          owner_id?: string
          owner_type?: string
          status?: string
          stripe_session_id?: string
        }
        Relationships: []
      }
      dexter_credit_ledger: {
        Row: {
          created_at_ms: number
          delta: number
          id: number
          owner_id: string
          owner_type: string
          reason: string
          request_id: string | null
          stripe_session_id: string | null
        }
        Insert: {
          created_at_ms: number
          delta: number
          id?: number
          owner_id: string
          owner_type: string
          reason: string
          request_id?: string | null
          stripe_session_id?: string | null
        }
        Update: {
          created_at_ms?: number
          delta?: number
          id?: number
          owner_id?: string
          owner_type?: string
          reason?: string
          request_id?: string | null
          stripe_session_id?: string | null
        }
        Relationships: []
      }
      dexter_research_requests: {
        Row: {
          answer: string | null
          created_at_ms: number
          credits_after: number
          credits_before: number
          error_message: string | null
          iterations: number | null
          owner_id: string
          owner_type: string
          query_text: string
          request_id: string
          status: string
          token_usage_json: string | null
          total_time_ms: number | null
          updated_at_ms: number
        }
        Insert: {
          answer?: string | null
          created_at_ms: number
          credits_after: number
          credits_before: number
          error_message?: string | null
          iterations?: number | null
          owner_id: string
          owner_type: string
          query_text: string
          request_id: string
          status: string
          token_usage_json?: string | null
          total_time_ms?: number | null
          updated_at_ms: number
        }
        Update: {
          answer?: string | null
          created_at_ms?: number
          credits_after?: number
          credits_before?: number
          error_message?: string | null
          iterations?: number | null
          owner_id?: string
          owner_type?: string
          query_text?: string
          request_id?: string
          status?: string
          token_usage_json?: string | null
          total_time_ms?: number | null
          updated_at_ms?: number
        }
        Relationships: []
      }
      dexter_stripe_events: {
        Row: {
          created_at_ms: number
          event_id: string
          event_type: string
          payload_json: string
        }
        Insert: {
          created_at_ms: number
          event_id: string
          event_type: string
          payload_json: string
        }
        Update: {
          created_at_ms?: number
          event_id?: string
          event_type?: string
          payload_json?: string
        }
        Relationships: []
      }
      investissement_av_lux_companies: {
        Row: {
          created_at: string | null
          cssf_code: string | null
          fund_universe_estimate: number | null
          group_company: string | null
          id: number
          name: string
          notes: string | null
          short_code: string
          website: string | null
        }
        Insert: {
          created_at?: string | null
          cssf_code?: string | null
          fund_universe_estimate?: number | null
          group_company?: string | null
          id?: number
          name: string
          notes?: string | null
          short_code: string
          website?: string | null
        }
        Update: {
          created_at?: string | null
          cssf_code?: string | null
          fund_universe_estimate?: number | null
          group_company?: string | null
          id?: number
          name?: string
          notes?: string | null
          short_code?: string
          website?: string | null
        }
        Relationships: []
      }
      investissement_av_lux_eligibility: {
        Row: {
          company_name: string
          contract_name: string
          created_at: string
          id: number
          isin: string
          scraped_at: string
          source_url: string | null
          universe_id: string | null
        }
        Insert: {
          company_name: string
          contract_name: string
          created_at?: string
          id?: number
          isin: string
          scraped_at?: string
          source_url?: string | null
          universe_id?: string | null
        }
        Update: {
          company_name?: string
          contract_name?: string
          created_at?: string
          id?: number
          isin?: string
          scraped_at?: string
          source_url?: string | null
          universe_id?: string | null
        }
        Relationships: []
      }
      investissement_fund_documents: {
        Row: {
          doc_type: string
          fetched_at: string | null
          file_hash: string | null
          id: string
          isin: string
          parsed_data: Json | null
          url: string | null
        }
        Insert: {
          doc_type: string
          fetched_at?: string | null
          file_hash?: string | null
          id?: string
          isin: string
          parsed_data?: Json | null
          url?: string | null
        }
        Update: {
          doc_type?: string
          fetched_at?: string | null
          file_hash?: string | null
          id?: string
          isin?: string
          parsed_data?: Json | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "investissement_fund_documents_isin_fkey"
            columns: ["isin"]
            isOneToOne: false
            referencedRelation: "investissement_funds"
            referencedColumns: ["isin"]
          },
          {
            foreignKeyName: "investissement_fund_documents_isin_fkey"
            columns: ["isin"]
            isOneToOne: false
            referencedRelation: "investissement_funds_cgp"
            referencedColumns: ["isin"]
          },
        ]
      }
      investissement_fund_prices: {
        Row: {
          currency: string | null
          isin: string
          nav: number | null
          price_date: string
          source: string | null
        }
        Insert: {
          currency?: string | null
          isin: string
          nav?: number | null
          price_date: string
          source?: string | null
        }
        Update: {
          currency?: string | null
          isin?: string
          nav?: number | null
          price_date?: string
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "investissement_fund_prices_isin_fkey"
            columns: ["isin"]
            isOneToOne: false
            referencedRelation: "investissement_funds"
            referencedColumns: ["isin"]
          },
          {
            foreignKeyName: "investissement_fund_prices_isin_fkey"
            columns: ["isin"]
            isOneToOne: false
            referencedRelation: "investissement_funds_cgp"
            referencedColumns: ["isin"]
          },
        ]
      }
      investissement_funds: {
        Row: {
          asset_class: string | null
          asset_class_broad: string | null
          aum_eur: number | null
          av_lux_eligible: boolean | null
          average_performance: number | null
          category: string | null
          category_normalized: string | null
          created_at: string | null
          currency: string | null
          data_completeness: number | null
          data_source: string | null
          distributor_france: boolean | null
          field_sources: Json | null
          hedged: boolean | null
          inception_date: string | null
          is_institutional: boolean | null
          isin: string
          kid_hash: string | null
          kid_parsed_at: string | null
          kid_url: string | null
          labels: Json | null
          management_company: string | null
          management_company_normalized: string | null
          management_style: string | null
          max_drawdown_1y: number | null
          max_drawdown_3y: number | null
          min_subscription_eur: number | null
          morningstar_rating: number | null
          name: string
          ongoing_charges: number | null
          pea_eligible: boolean | null
          per_eligible: boolean | null
          performance_1y: number | null
          performance_3y: number | null
          performance_5y: number | null
          product_type: string | null
          region_exposure: string | null
          region_normalized: string | null
          risk_level: string | null
          sector: string | null
          sfdr_article: number | null
          share_class_group_id: string | null
          sharpe_1y: number | null
          sharpe_3y: number | null
          sri: number | null
          srri: number | null
          ter: number | null
          track_record_years: number | null
          ucits_compliant: boolean | null
          updated_at: string | null
          volatility_1y: number | null
          volatility_3y: number | null
        }
        Insert: {
          asset_class?: string | null
          asset_class_broad?: string | null
          aum_eur?: number | null
          av_lux_eligible?: boolean | null
          average_performance?: number | null
          category?: string | null
          category_normalized?: string | null
          created_at?: string | null
          currency?: string | null
          data_completeness?: number | null
          data_source?: string | null
          distributor_france?: boolean | null
          field_sources?: Json | null
          hedged?: boolean | null
          inception_date?: string | null
          is_institutional?: boolean | null
          isin: string
          kid_hash?: string | null
          kid_parsed_at?: string | null
          kid_url?: string | null
          labels?: Json | null
          management_company?: string | null
          management_company_normalized?: string | null
          management_style?: string | null
          max_drawdown_1y?: number | null
          max_drawdown_3y?: number | null
          min_subscription_eur?: number | null
          morningstar_rating?: number | null
          name: string
          ongoing_charges?: number | null
          pea_eligible?: boolean | null
          per_eligible?: boolean | null
          performance_1y?: number | null
          performance_3y?: number | null
          performance_5y?: number | null
          product_type?: string | null
          region_exposure?: string | null
          region_normalized?: string | null
          risk_level?: string | null
          sector?: string | null
          sfdr_article?: number | null
          share_class_group_id?: string | null
          sharpe_1y?: number | null
          sharpe_3y?: number | null
          sri?: number | null
          srri?: number | null
          ter?: number | null
          track_record_years?: number | null
          ucits_compliant?: boolean | null
          updated_at?: string | null
          volatility_1y?: number | null
          volatility_3y?: number | null
        }
        Update: {
          asset_class?: string | null
          asset_class_broad?: string | null
          aum_eur?: number | null
          av_lux_eligible?: boolean | null
          average_performance?: number | null
          category?: string | null
          category_normalized?: string | null
          created_at?: string | null
          currency?: string | null
          data_completeness?: number | null
          data_source?: string | null
          distributor_france?: boolean | null
          field_sources?: Json | null
          hedged?: boolean | null
          inception_date?: string | null
          is_institutional?: boolean | null
          isin?: string
          kid_hash?: string | null
          kid_parsed_at?: string | null
          kid_url?: string | null
          labels?: Json | null
          management_company?: string | null
          management_company_normalized?: string | null
          management_style?: string | null
          max_drawdown_1y?: number | null
          max_drawdown_3y?: number | null
          min_subscription_eur?: number | null
          morningstar_rating?: number | null
          name?: string
          ongoing_charges?: number | null
          pea_eligible?: boolean | null
          per_eligible?: boolean | null
          performance_1y?: number | null
          performance_3y?: number | null
          performance_5y?: number | null
          product_type?: string | null
          region_exposure?: string | null
          region_normalized?: string | null
          risk_level?: string | null
          sector?: string | null
          sfdr_article?: number | null
          share_class_group_id?: string | null
          sharpe_1y?: number | null
          sharpe_3y?: number | null
          sri?: number | null
          srri?: number | null
          ter?: number | null
          track_record_years?: number | null
          ucits_compliant?: boolean | null
          updated_at?: string | null
          volatility_1y?: number | null
          volatility_3y?: number | null
        }
        Relationships: []
      }
      investissement_pipeline_runs: {
        Row: {
          completed_at: string | null
          errors: Json | null
          id: string
          records_failed: number | null
          records_processed: number | null
          scraper: string
          started_at: string | null
          status: string | null
        }
        Insert: {
          completed_at?: string | null
          errors?: Json | null
          id?: string
          records_failed?: number | null
          records_processed?: number | null
          scraper: string
          started_at?: string | null
          status?: string | null
        }
        Update: {
          completed_at?: string | null
          errors?: Json | null
          id?: string
          records_failed?: number | null
          records_processed?: number | null
          scraper?: string
          started_at?: string | null
          status?: string | null
        }
        Relationships: []
      }
      investissement_scpi_metrics: {
        Row: {
          capitalization: number | null
          dvm: number | null
          isin: string
          period: string | null
          price_per_share: number | null
          tof: number | null
          updated_at: string | null
        }
        Insert: {
          capitalization?: number | null
          dvm?: number | null
          isin: string
          period?: string | null
          price_per_share?: number | null
          tof?: number | null
          updated_at?: string | null
        }
        Update: {
          capitalization?: number | null
          dvm?: number | null
          isin?: string
          period?: string | null
          price_per_share?: number | null
          tof?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "investissement_scpi_metrics_isin_fkey"
            columns: ["isin"]
            isOneToOne: true
            referencedRelation: "investissement_funds"
            referencedColumns: ["isin"]
          },
          {
            foreignKeyName: "investissement_scpi_metrics_isin_fkey"
            columns: ["isin"]
            isOneToOne: true
            referencedRelation: "investissement_funds_cgp"
            referencedColumns: ["isin"]
          },
        ]
      }
      prospection_signals_inbox: {
        Row: {
          code_naf: string | null
          date_event: string
          departement: string | null
          entreprise_nom: string | null
          external_id: string
          id: string
          ingested_at: string
          matched_org_ids: string[]
          raw_data: Json
          siren: string | null
          source: string
          type_event: string
        }
        Insert: {
          code_naf?: string | null
          date_event: string
          departement?: string | null
          entreprise_nom?: string | null
          external_id: string
          id?: string
          ingested_at?: string
          matched_org_ids?: string[]
          raw_data: Json
          siren?: string | null
          source: string
          type_event: string
        }
        Update: {
          code_naf?: string | null
          date_event?: string
          departement?: string | null
          entreprise_nom?: string | null
          external_id?: string
          id?: string
          ingested_at?: string
          matched_org_ids?: string[]
          raw_data?: Json
          siren?: string | null
          source?: string
          type_event?: string
        }
        Relationships: []
      }
      rapport_anonymous_daily_usage: {
        Row: {
          count: number
          created_at: string
          day_key: string
          id: string
          ip_hash: string
          ua_hash: string
        }
        Insert: {
          count?: number
          created_at?: string
          day_key: string
          id?: string
          ip_hash: string
          ua_hash: string
        }
        Update: {
          count?: number
          created_at?: string
          day_key?: string
          id?: string
          ip_hash?: string
          ua_hash?: string
        }
        Relationships: []
      }
      rapport_anonymous_sessions: {
        Row: {
          anonymous_id: string
          first_seen_at: string
          free_used_count: number
          id: string
          ip_hash: string
          last_seen_at: string
          ua_hash: string
        }
        Insert: {
          anonymous_id: string
          first_seen_at?: string
          free_used_count?: number
          id?: string
          ip_hash: string
          last_seen_at?: string
          ua_hash: string
        }
        Update: {
          anonymous_id?: string
          first_seen_at?: string
          free_used_count?: number
          id?: string
          ip_hash?: string
          last_seen_at?: string
          ua_hash?: string
        }
        Relationships: []
      }
      rapport_anonymous_to_user_links: {
        Row: {
          anonymous_id: string
          linked_at: string
          user_id: string
        }
        Insert: {
          anonymous_id: string
          linked_at?: string
          user_id: string
        }
        Update: {
          anonymous_id?: string
          linked_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rapport_anonymous_to_user_links_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "rapport_users"
            referencedColumns: ["id"]
          },
        ]
      }
      rapport_credit_accounts: {
        Row: {
          balance: number
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rapport_credit_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "rapport_users"
            referencedColumns: ["id"]
          },
        ]
      }
      rapport_credit_ledger: {
        Row: {
          balance_after: number
          created_at: string
          credit_delta: number
          id: string
          metadata: Json | null
          reason: string
          reference: string | null
          user_id: string
        }
        Insert: {
          balance_after: number
          created_at?: string
          credit_delta: number
          id?: string
          metadata?: Json | null
          reason: string
          reference?: string | null
          user_id: string
        }
        Update: {
          balance_after?: number
          created_at?: string
          credit_delta?: number
          id?: string
          metadata?: Json | null
          reason?: string
          reference?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rapport_credit_ledger_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "rapport_users"
            referencedColumns: ["id"]
          },
        ]
      }
      rapport_purchases: {
        Row: {
          amount_cents: number
          created_at: string
          credits_purchased: number
          currency: string
          id: string
          status: string
          stripe_session_id: string
          user_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          credits_purchased: number
          currency?: string
          id?: string
          status?: string
          stripe_session_id: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          credits_purchased?: number
          currency?: string
          id?: string
          status?: string
          stripe_session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rapport_purchases_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "rapport_users"
            referencedColumns: ["id"]
          },
        ]
      }
      rapport_reports: {
        Row: {
          created_at: string
          id: string
          input_payload: Json
          owner_id: string
          owner_type: string
          period: string
          report_payload: Json | null
          report_type: string
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          input_payload: Json
          owner_id: string
          owner_type: string
          period: string
          report_payload?: Json | null
          report_type: string
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          input_payload?: Json
          owner_id?: string
          owner_type?: string
          period?: string
          report_payload?: Json | null
          report_type?: string
          status?: string
        }
        Relationships: []
      }
      rapport_users: {
        Row: {
          auth_user_id: string | null
          client_id: string
          created_at: string
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          profession: string | null
          stripe_customer_id: string | null
        }
        Insert: {
          auth_user_id?: string | null
          client_id: string
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          profession?: string | null
          stripe_customer_id?: string | null
        }
        Update: {
          auth_user_id?: string | null
          client_id?: string
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          profession?: string | null
          stripe_customer_id?: string | null
        }
        Relationships: []
      }
      screener_credit_wallet: {
        Row: {
          client_id: string
          free_credits: number
          free_credits_exhausted_at: string | null
          id: string
          paid_credits: number
          updated_at: string
        }
        Insert: {
          client_id: string
          free_credits?: number
          free_credits_exhausted_at?: string | null
          id?: string
          paid_credits?: number
          updated_at?: string
        }
        Update: {
          client_id?: string
          free_credits?: number
          free_credits_exhausted_at?: string | null
          id?: string
          paid_credits?: number
          updated_at?: string
        }
        Relationships: []
      }
      screener_stripe_webhook_events: {
        Row: {
          event_id: string
          processed_at: string
        }
        Insert: {
          event_id: string
          processed_at?: string
        }
        Update: {
          event_id?: string
          processed_at?: string
        }
        Relationships: []
      }
      screener_transactions: {
        Row: {
          client_id: string
          created_at: string
          credits_added: number | null
          credits_used: number | null
          id: string
          stripe_event_id: string | null
          stripe_payment_intent: string | null
          stripe_price_id: string | null
          type: string
        }
        Insert: {
          client_id: string
          created_at?: string
          credits_added?: number | null
          credits_used?: number | null
          id?: string
          stripe_event_id?: string | null
          stripe_payment_intent?: string | null
          stripe_price_id?: string | null
          type: string
        }
        Update: {
          client_id?: string
          created_at?: string
          credits_added?: number | null
          credits_used?: number | null
          id?: string
          stripe_event_id?: string | null
          stripe_payment_intent?: string | null
          stripe_price_id?: string | null
          type?: string
        }
        Relationships: []
      }
      screener_users: {
        Row: {
          client_id: string
          created_at: string
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          profession: string | null
          stripe_customer_id: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          profession?: string | null
          stripe_customer_id?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          profession?: string | null
          stripe_customer_id?: string | null
        }
        Relationships: []
      }
      waitlist: {
        Row: {
          country: string
          created_at: string
          email: string
          full_name: string
          id: string
          phone: string | null
        }
        Insert: {
          country: string
          created_at?: string
          email: string
          full_name: string
          id?: string
          phone?: string | null
        }
        Update: {
          country?: string
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          phone?: string | null
        }
        Relationships: []
      }
      waitlist_survey_responses: {
        Row: {
          active_clients: string | null
          country: string | null
          created_at: string
          current_setup: string | null
          deployment_timeline: string | null
          email: string | null
          full_name: string | null
          growth_levers: string[] | null
          id: number
          more_info_topic: string | null
          profile: string | null
          referral: string | null
          target_90d: string | null
          time_spent: string | null
          value_gap: string | null
          waitlist_id: string
        }
        Insert: {
          active_clients?: string | null
          country?: string | null
          created_at?: string
          current_setup?: string | null
          deployment_timeline?: string | null
          email?: string | null
          full_name?: string | null
          growth_levers?: string[] | null
          id?: number
          more_info_topic?: string | null
          profile?: string | null
          referral?: string | null
          target_90d?: string | null
          time_spent?: string | null
          value_gap?: string | null
          waitlist_id: string
        }
        Update: {
          active_clients?: string | null
          country?: string | null
          created_at?: string
          current_setup?: string | null
          deployment_timeline?: string | null
          email?: string | null
          full_name?: string | null
          growth_levers?: string[] | null
          id?: number
          more_info_topic?: string | null
          profile?: string | null
          referral?: string | null
          target_90d?: string | null
          time_spent?: string | null
          value_gap?: string | null
          waitlist_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "waitlist_survey_responses_waitlist_id_fkey"
            columns: ["waitlist_id"]
            isOneToOne: false
            referencedRelation: "waitlist"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      investissement_funds_cgp: {
        Row: {
          accessible_retail: boolean | null
          asset_class: string | null
          asset_class_broad: string | null
          aum_eur: number | null
          av_lux_eligible: boolean | null
          average_performance: number | null
          category_normalized: string | null
          currency: string | null
          data_completeness: number | null
          data_source: string | null
          field_sources: Json | null
          gestionnaire: string | null
          hedged: boolean | null
          inception_date: string | null
          is_institutional: boolean | null
          isin: string | null
          kid_parsed_at: string | null
          kid_url: string | null
          labels: Json | null
          management_style: string | null
          max_drawdown_1y: number | null
          max_drawdown_3y: number | null
          morningstar_rating: number | null
          name: string | null
          ongoing_charges: number | null
          pea_eligible: boolean | null
          per_eligible: boolean | null
          performance_1y: number | null
          performance_3y: number | null
          performance_5y: number | null
          product_type: string | null
          region_normalized: string | null
          risk_score: number | null
          sector: string | null
          sfdr_article: number | null
          share_class_group_id: string | null
          sharpe_1y: number | null
          sharpe_3y: number | null
          ter: number | null
          track_record_years: number | null
          ucits_compliant: boolean | null
          updated_at: string | null
          volatility_1y: number | null
          volatility_3y: number | null
        }
        Insert: {
          accessible_retail?: never
          asset_class?: string | null
          asset_class_broad?: string | null
          aum_eur?: number | null
          av_lux_eligible?: boolean | null
          average_performance?: number | null
          category_normalized?: string | null
          currency?: string | null
          data_completeness?: number | null
          data_source?: string | null
          field_sources?: Json | null
          gestionnaire?: string | null
          hedged?: boolean | null
          inception_date?: string | null
          is_institutional?: boolean | null
          isin?: string | null
          kid_parsed_at?: string | null
          kid_url?: string | null
          labels?: Json | null
          management_style?: string | null
          max_drawdown_1y?: number | null
          max_drawdown_3y?: number | null
          morningstar_rating?: number | null
          name?: string | null
          ongoing_charges?: never
          pea_eligible?: boolean | null
          per_eligible?: boolean | null
          performance_1y?: number | null
          performance_3y?: number | null
          performance_5y?: number | null
          product_type?: string | null
          region_normalized?: string | null
          risk_score?: number | null
          sector?: string | null
          sfdr_article?: number | null
          share_class_group_id?: string | null
          sharpe_1y?: number | null
          sharpe_3y?: number | null
          ter?: never
          track_record_years?: number | null
          ucits_compliant?: boolean | null
          updated_at?: string | null
          volatility_1y?: number | null
          volatility_3y?: number | null
        }
        Update: {
          accessible_retail?: never
          asset_class?: string | null
          asset_class_broad?: string | null
          aum_eur?: number | null
          av_lux_eligible?: boolean | null
          average_performance?: number | null
          category_normalized?: string | null
          currency?: string | null
          data_completeness?: number | null
          data_source?: string | null
          field_sources?: Json | null
          gestionnaire?: string | null
          hedged?: boolean | null
          inception_date?: string | null
          is_institutional?: boolean | null
          isin?: string | null
          kid_parsed_at?: string | null
          kid_url?: string | null
          labels?: Json | null
          management_style?: string | null
          max_drawdown_1y?: number | null
          max_drawdown_3y?: number | null
          morningstar_rating?: number | null
          name?: string | null
          ongoing_charges?: never
          pea_eligible?: boolean | null
          per_eligible?: boolean | null
          performance_1y?: number | null
          performance_3y?: number | null
          performance_5y?: number | null
          product_type?: string | null
          region_normalized?: string | null
          risk_score?: number | null
          sector?: string | null
          sfdr_article?: number | null
          share_class_group_id?: string | null
          sharpe_1y?: number | null
          sharpe_3y?: number | null
          ter?: never
          track_record_years?: number | null
          ucits_compliant?: boolean | null
          updated_at?: string | null
          volatility_1y?: number | null
          volatility_3y?: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      append_matched_org_to_signals: {
        Args: {
          p_departements: string[]
          p_naf_codes: string[]
          p_org_id: string
          p_since: string
        }
        Returns: {
          signal_id: string
        }[]
      }
      charlie_dossier_purge_expired: { Args: never; Returns: number }
      finalize_waitlist_followups: {
        Args: { batch_size?: number }
        Returns: undefined
      }
      get_waitlist_position: {
        Args: { p_waitlist_id: string }
        Returns: number
      }
      process_waitlist_followups: {
        Args: { batch_size?: number }
        Returns: undefined
      }
      screener_apply_stripe_topup: {
        Args: {
          p_client_id: string
          p_credits: number
          p_email: string
          p_event_id: string
          p_first_name: string
          p_last_name: string
          p_payment_intent: string
          p_price_id: string
          p_profession: string
          p_stripe_customer_id: string
        }
        Returns: boolean
      }
      screener_claim_stripe_webhook_event: {
        Args: { p_event_id: string }
        Returns: boolean
      }
      screener_consume_credit: {
        Args: { p_client_id: string }
        Returns: {
          free_remaining: number
          paid_remaining: number
          reset_at: string
          success: boolean
        }[]
      }
      screener_get_credits: {
        Args: { p_client_id: string }
        Returns: {
          free_credits: number
          paid_credits: number
          reset_at: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
