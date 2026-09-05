export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      assistance_assignments: {
        Row: {
          access_notes: string | null
          assistant_id: string
          created_at: string
          id: string
          instructions: string | null
          parking_notes: string | null
          plan_waypoint_id: string | null
          planned_at: string | null
          race_waypoint_id: string
          sort_order: number
          updated_at: string
          window_after_minutes: number
          window_before_minutes: number
        }
        Insert: {
          access_notes?: string | null
          assistant_id: string
          created_at?: string
          id?: string
          instructions?: string | null
          parking_notes?: string | null
          plan_waypoint_id?: string | null
          planned_at?: string | null
          race_waypoint_id: string
          sort_order?: number
          updated_at?: string
          window_after_minutes?: number
          window_before_minutes?: number
        }
        Update: {
          access_notes?: string | null
          assistant_id?: string
          created_at?: string
          id?: string
          instructions?: string | null
          parking_notes?: string | null
          plan_waypoint_id?: string | null
          planned_at?: string | null
          race_waypoint_id?: string
          sort_order?: number
          updated_at?: string
          window_after_minutes?: number
          window_before_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "assistance_assignments_assistant_id_fkey"
            columns: ["assistant_id"]
            isOneToOne: false
            referencedRelation: "race_assistants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assistance_assignments_plan_waypoint_id_fkey"
            columns: ["plan_waypoint_id"]
            isOneToOne: false
            referencedRelation: "plan_waypoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assistance_assignments_race_waypoint_id_fkey"
            columns: ["race_waypoint_id"]
            isOneToOne: false
            referencedRelation: "race_waypoints"
            referencedColumns: ["id"]
          },
        ]
      }
      assistance_items: {
        Row: {
          assistance_assignment_id: string
          checked: boolean
          created_at: string
          id: string
          item_type: Database["public"]["Enums"]["assistance_item_type"]
          label: string
          quantity: number
          source_bag_item_id: string | null
          source_nutrition_waypoint_item_id: string | null
          unit: string | null
        }
        Insert: {
          assistance_assignment_id: string
          checked?: boolean
          created_at?: string
          id?: string
          item_type: Database["public"]["Enums"]["assistance_item_type"]
          label: string
          quantity?: number
          source_bag_item_id?: string | null
          source_nutrition_waypoint_item_id?: string | null
          unit?: string | null
        }
        Update: {
          assistance_assignment_id?: string
          checked?: boolean
          created_at?: string
          id?: string
          item_type?: Database["public"]["Enums"]["assistance_item_type"]
          label?: string
          quantity?: number
          source_bag_item_id?: string | null
          source_nutrition_waypoint_item_id?: string | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assistance_items_assistance_assignment_id_fkey"
            columns: ["assistance_assignment_id"]
            isOneToOne: false
            referencedRelation: "assistance_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assistance_items_source_bag_item_id_fkey"
            columns: ["source_bag_item_id"]
            isOneToOne: false
            referencedRelation: "bag_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assistance_items_source_nutrition_waypoint_item_id_fkey"
            columns: ["source_nutrition_waypoint_item_id"]
            isOneToOne: false
            referencedRelation: "nutrition_waypoint_items"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_access_tokens: {
        Row: {
          assistant_id: string
          created_at: string
          expires_at: string | null
          id: string
          last_used_at: string | null
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          assistant_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          assistant_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_access_tokens_assistant_id_fkey"
            columns: ["assistant_id"]
            isOneToOne: false
            referencedRelation: "race_assistants"
            referencedColumns: ["id"]
          },
        ]
      }
      bag_items: {
        Row: {
          bag_id: string
          checked: boolean
          created_at: string
          equipment_item_id: string | null
          id: string
          item_type: Database["public"]["Enums"]["bag_item_type"]
          label: string | null
          quantity: number
          unit: string | null
          user_nutrition_product_id: string | null
        }
        Insert: {
          bag_id: string
          checked?: boolean
          created_at?: string
          equipment_item_id?: string | null
          id?: string
          item_type: Database["public"]["Enums"]["bag_item_type"]
          label?: string | null
          quantity?: number
          unit?: string | null
          user_nutrition_product_id?: string | null
        }
        Update: {
          bag_id?: string
          checked?: boolean
          created_at?: string
          equipment_item_id?: string | null
          id?: string
          item_type?: Database["public"]["Enums"]["bag_item_type"]
          label?: string | null
          quantity?: number
          unit?: string | null
          user_nutrition_product_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bag_items_bag_id_fkey"
            columns: ["bag_id"]
            isOneToOne: false
            referencedRelation: "bags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bag_items_equipment_item_id_fkey"
            columns: ["equipment_item_id"]
            isOneToOne: false
            referencedRelation: "equipment_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bag_items_user_nutrition_product_id_fkey"
            columns: ["user_nutrition_product_id"]
            isOneToOne: false
            referencedRelation: "user_nutrition_products"
            referencedColumns: ["id"]
          },
        ]
      }
      bags: {
        Row: {
          assigned_assistant_id: string | null
          bag_type: Database["public"]["Enums"]["bag_type"]
          created_at: string
          id: string
          name: string
          notes: string | null
          participant_race_id: string
          race_waypoint_id: string | null
          updated_at: string
        }
        Insert: {
          assigned_assistant_id?: string | null
          bag_type: Database["public"]["Enums"]["bag_type"]
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          participant_race_id: string
          race_waypoint_id?: string | null
          updated_at?: string
        }
        Update: {
          assigned_assistant_id?: string | null
          bag_type?: Database["public"]["Enums"]["bag_type"]
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          participant_race_id?: string
          race_waypoint_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bags_participant_race_id_fkey"
            columns: ["participant_race_id"]
            isOneToOne: false
            referencedRelation: "participant_races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bags_race_waypoint_id_fkey"
            columns: ["race_waypoint_id"]
            isOneToOne: false
            referencedRelation: "race_waypoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_bags_assigned_assistant"
            columns: ["assigned_assistant_id"]
            isOneToOne: false
            referencedRelation: "race_assistants"
            referencedColumns: ["id"]
          },
        ]
      }
      beta_access_grants: {
        Row: {
          created_at: string
          created_by_user_id: string | null
          ends_at: string | null
          id: string
          participant_race_id: string | null
          reason: string | null
          revoke_reason: string | null
          revoked_at: string | null
          scope_type: Database["public"]["Enums"]["entitlement_scope_type"]
          starts_at: string
          status: Database["public"]["Enums"]["entitlement_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by_user_id?: string | null
          ends_at?: string | null
          id?: string
          participant_race_id?: string | null
          reason?: string | null
          revoke_reason?: string | null
          revoked_at?: string | null
          scope_type: Database["public"]["Enums"]["entitlement_scope_type"]
          starts_at?: string
          status?: Database["public"]["Enums"]["entitlement_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string | null
          ends_at?: string | null
          id?: string
          participant_race_id?: string | null
          reason?: string | null
          revoke_reason?: string | null
          revoked_at?: string | null
          scope_type?: Database["public"]["Enums"]["entitlement_scope_type"]
          starts_at?: string
          status?: Database["public"]["Enums"]["entitlement_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "beta_access_grants_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "beta_access_grants_participant_race_id_fkey"
            columns: ["participant_race_id"]
            isOneToOne: false
            referencedRelation: "participant_races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "beta_access_grants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      community_posts: {
        Row: {
          author_user_id: string
          body: string
          created_at: string
          id: string
          status: Database["public"]["Enums"]["community_content_status"]
          thread_id: string
          updated_at: string
        }
        Insert: {
          author_user_id: string
          body: string
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["community_content_status"]
          thread_id: string
          updated_at?: string
        }
        Update: {
          author_user_id?: string
          body?: string
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["community_content_status"]
          thread_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_posts_author_user_id_fkey"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_posts_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "community_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      community_reactions: {
        Row: {
          created_at: string
          id: string
          post_id: string | null
          reaction_type: Database["public"]["Enums"]["reaction_type"]
          thread_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          post_id?: string | null
          reaction_type?: Database["public"]["Enums"]["reaction_type"]
          thread_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          post_id?: string | null
          reaction_type?: Database["public"]["Enums"]["reaction_type"]
          thread_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_reactions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_reactions_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "community_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      community_reports: {
        Row: {
          created_at: string
          details: string | null
          id: string
          post_id: string | null
          reason: Database["public"]["Enums"]["report_reason"]
          reporter_user_id: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["report_status"]
          thread_id: string | null
        }
        Insert: {
          created_at?: string
          details?: string | null
          id?: string
          post_id?: string | null
          reason: Database["public"]["Enums"]["report_reason"]
          reporter_user_id: string
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          thread_id?: string | null
        }
        Update: {
          created_at?: string
          details?: string | null
          id?: string
          post_id?: string | null
          reason?: Database["public"]["Enums"]["report_reason"]
          reporter_user_id?: string
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          thread_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "community_reports_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_reports_reporter_user_id_fkey"
            columns: ["reporter_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_reports_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "community_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      community_threads: {
        Row: {
          author_user_id: string
          body: string
          category: Database["public"]["Enums"]["community_category"]
          created_at: string
          edition_id: string
          id: string
          linked_segment_id: string | null
          linked_waypoint_id: string | null
          race_id: string | null
          status: Database["public"]["Enums"]["community_content_status"]
          title: string
          updated_at: string
        }
        Insert: {
          author_user_id: string
          body: string
          category: Database["public"]["Enums"]["community_category"]
          created_at?: string
          edition_id: string
          id?: string
          linked_segment_id?: string | null
          linked_waypoint_id?: string | null
          race_id?: string | null
          status?: Database["public"]["Enums"]["community_content_status"]
          title: string
          updated_at?: string
        }
        Update: {
          author_user_id?: string
          body?: string
          category?: Database["public"]["Enums"]["community_category"]
          created_at?: string
          edition_id?: string
          id?: string
          linked_segment_id?: string | null
          linked_waypoint_id?: string | null
          race_id?: string | null
          status?: Database["public"]["Enums"]["community_content_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_threads_author_user_id_fkey"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_threads_edition_id_fkey"
            columns: ["edition_id"]
            isOneToOne: false
            referencedRelation: "editions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_threads_linked_segment_id_fkey"
            columns: ["linked_segment_id"]
            isOneToOne: false
            referencedRelation: "race_segments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_threads_linked_waypoint_id_fkey"
            columns: ["linked_waypoint_id"]
            isOneToOne: false
            referencedRelation: "race_waypoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_threads_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      condition_periods: {
        Row: {
          condition_type: Database["public"]["Enums"]["detected_condition_type"]
          created_at: string
          end_datetime: string
          end_elapsed_seconds: number | null
          end_point_key: string | null
          id: string
          label: string | null
          severity: number | null
          source: Database["public"]["Enums"]["condition_source"]
          start_datetime: string
          start_elapsed_seconds: number | null
          start_point_key: string | null
          summary: Json
          weather_run_id: string
        }
        Insert: {
          condition_type: Database["public"]["Enums"]["detected_condition_type"]
          created_at?: string
          end_datetime: string
          end_elapsed_seconds?: number | null
          end_point_key?: string | null
          id?: string
          label?: string | null
          severity?: number | null
          source: Database["public"]["Enums"]["condition_source"]
          start_datetime: string
          start_elapsed_seconds?: number | null
          start_point_key?: string | null
          summary?: Json
          weather_run_id: string
        }
        Update: {
          condition_type?: Database["public"]["Enums"]["detected_condition_type"]
          created_at?: string
          end_datetime?: string
          end_elapsed_seconds?: number | null
          end_point_key?: string | null
          id?: string
          label?: string | null
          severity?: number | null
          source?: Database["public"]["Enums"]["condition_source"]
          start_datetime?: string
          start_elapsed_seconds?: number | null
          start_point_key?: string | null
          summary?: Json
          weather_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "condition_periods_weather_run_id_fkey"
            columns: ["weather_run_id"]
            isOneToOne: false
            referencedRelation: "weather_forecast_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      condition_proposals: {
        Row: {
          applied_at: string | null
          before_payload: Json
          condition_period_id: string
          created_at: string
          dismissed_at: string | null
          id: string
          impact_payload: Json
          outing_id: string | null
          participant_race_id: string | null
          proposed_payload: Json
          status: Database["public"]["Enums"]["proposal_status"]
          target_module: Database["public"]["Enums"]["proposal_target_module"]
          user_id: string
        }
        Insert: {
          applied_at?: string | null
          before_payload?: Json
          condition_period_id: string
          created_at?: string
          dismissed_at?: string | null
          id?: string
          impact_payload?: Json
          outing_id?: string | null
          participant_race_id?: string | null
          proposed_payload?: Json
          status?: Database["public"]["Enums"]["proposal_status"]
          target_module: Database["public"]["Enums"]["proposal_target_module"]
          user_id: string
        }
        Update: {
          applied_at?: string | null
          before_payload?: Json
          condition_period_id?: string
          created_at?: string
          dismissed_at?: string | null
          id?: string
          impact_payload?: Json
          outing_id?: string | null
          participant_race_id?: string | null
          proposed_payload?: Json
          status?: Database["public"]["Enums"]["proposal_status"]
          target_module?: Database["public"]["Enums"]["proposal_target_module"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "condition_proposals_condition_period_id_fkey"
            columns: ["condition_period_id"]
            isOneToOne: false
            referencedRelation: "condition_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "condition_proposals_outing_id_fkey"
            columns: ["outing_id"]
            isOneToOne: false
            referencedRelation: "outings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "condition_proposals_participant_race_id_fkey"
            columns: ["participant_race_id"]
            isOneToOne: false
            referencedRelation: "participant_races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "condition_proposals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      editions: {
        Row: {
          created_at: string
          end_date: string | null
          event_id: string
          id: string
          slug: string
          start_date: string
          status: Database["public"]["Enums"]["edition_status"]
          updated_at: string
          year: number
        }
        Insert: {
          created_at?: string
          end_date?: string | null
          event_id: string
          id?: string
          slug: string
          start_date: string
          status?: Database["public"]["Enums"]["edition_status"]
          updated_at?: string
          year: number
        }
        Update: {
          created_at?: string
          end_date?: string | null
          event_id?: string
          id?: string
          slug?: string
          start_date?: string
          status?: Database["public"]["Enums"]["edition_status"]
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "editions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      emergency_contacts: {
        Row: {
          created_at: string
          explicit_consent_at: string
          first_name: string
          id: string
          last_name: string | null
          participant_race_id: string
          phone: string
          relationship_label: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          explicit_consent_at: string
          first_name: string
          id?: string
          last_name?: string | null
          participant_race_id: string
          phone: string
          relationship_label?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          explicit_consent_at?: string
          first_name?: string
          id?: string
          last_name?: string | null
          participant_race_id?: string
          phone?: string
          relationship_label?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "emergency_contacts_participant_race_id_fkey"
            columns: ["participant_race_id"]
            isOneToOne: false
            referencedRelation: "participant_races"
            referencedColumns: ["id"]
          },
        ]
      }
      enrichment_import_rows: {
        Row: {
          candidate_matches: Json
          created_at: string
          enrichment_import_id: string
          id: string
          match_status: Database["public"]["Enums"]["enrichment_match_status"]
          matched_participant_race_id: string | null
          raw_data: Json
          reviewed_at: string | null
          reviewed_by_user_id: string | null
          row_number: number
        }
        Insert: {
          candidate_matches?: Json
          created_at?: string
          enrichment_import_id: string
          id?: string
          match_status?: Database["public"]["Enums"]["enrichment_match_status"]
          matched_participant_race_id?: string | null
          raw_data: Json
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          row_number: number
        }
        Update: {
          candidate_matches?: Json
          created_at?: string
          enrichment_import_id?: string
          id?: string
          match_status?: Database["public"]["Enums"]["enrichment_match_status"]
          matched_participant_race_id?: string | null
          raw_data?: Json
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          row_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "enrichment_import_rows_enrichment_import_id_fkey"
            columns: ["enrichment_import_id"]
            isOneToOne: false
            referencedRelation: "enrichment_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrichment_import_rows_matched_participant_race_id_fkey"
            columns: ["matched_participant_race_id"]
            isOneToOne: false
            referencedRelation: "participant_races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrichment_import_rows_reviewed_by_user_id_fkey"
            columns: ["reviewed_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      enrichment_imports: {
        Row: {
          created_at: string
          created_by_user_id: string | null
          id: string
          organization_id: string
          provider: Database["public"]["Enums"]["enrichment_provider"]
          race_id: string
          status: Database["public"]["Enums"]["import_status"]
          storage_path: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          organization_id: string
          provider: Database["public"]["Enums"]["enrichment_provider"]
          race_id: string
          status?: Database["public"]["Enums"]["import_status"]
          storage_path: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          organization_id?: string
          provider?: Database["public"]["Enums"]["enrichment_provider"]
          race_id?: string
          status?: Database["public"]["Enums"]["import_status"]
          storage_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrichment_imports_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrichment_imports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrichment_imports_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      entitlement_usage: {
        Row: {
          capability: string
          entitlement_id: string
          id: string
          metadata: Json
          occurred_at: string
          outing_id: string | null
          participant_race_id: string | null
          usage_key: string
          user_id: string
        }
        Insert: {
          capability: string
          entitlement_id: string
          id?: string
          metadata?: Json
          occurred_at?: string
          outing_id?: string | null
          participant_race_id?: string | null
          usage_key: string
          user_id: string
        }
        Update: {
          capability?: string
          entitlement_id?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          outing_id?: string | null
          participant_race_id?: string | null
          usage_key?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entitlement_usage_entitlement_id_fkey"
            columns: ["entitlement_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entitlement_usage_outing_id_fkey"
            columns: ["outing_id"]
            isOneToOne: false
            referencedRelation: "outings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entitlement_usage_participant_race_id_fkey"
            columns: ["participant_race_id"]
            isOneToOne: false
            referencedRelation: "participant_races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entitlement_usage_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      entitlements: {
        Row: {
          created_at: string
          ends_at: string | null
          external_reference: string | null
          id: string
          kind: Database["public"]["Enums"]["entitlement_kind"]
          metadata: Json
          organization_id: string | null
          participant_race_id: string | null
          revoke_reason: string | null
          revoked_at: string | null
          revoked_by_user_id: string | null
          scope_type: Database["public"]["Enums"]["entitlement_scope_type"]
          source: Database["public"]["Enums"]["entitlement_source"]
          starts_at: string
          status: Database["public"]["Enums"]["entitlement_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          ends_at?: string | null
          external_reference?: string | null
          id?: string
          kind: Database["public"]["Enums"]["entitlement_kind"]
          metadata?: Json
          organization_id?: string | null
          participant_race_id?: string | null
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by_user_id?: string | null
          scope_type: Database["public"]["Enums"]["entitlement_scope_type"]
          source: Database["public"]["Enums"]["entitlement_source"]
          starts_at?: string
          status?: Database["public"]["Enums"]["entitlement_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          ends_at?: string | null
          external_reference?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["entitlement_kind"]
          metadata?: Json
          organization_id?: string | null
          participant_race_id?: string | null
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by_user_id?: string | null
          scope_type?: Database["public"]["Enums"]["entitlement_scope_type"]
          source?: Database["public"]["Enums"]["entitlement_source"]
          starts_at?: string
          status?: Database["public"]["Enums"]["entitlement_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entitlements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entitlements_participant_race_id_fkey"
            columns: ["participant_race_id"]
            isOneToOne: false
            referencedRelation: "participant_races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entitlements_revoked_by_user_id_fkey"
            columns: ["revoked_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entitlements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_items: {
        Row: {
          canonical_key: string | null
          category: Database["public"]["Enums"]["equipment_category"]
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          canonical_key?: string | null
          category: Database["public"]["Enums"]["equipment_category"]
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          canonical_key?: string | null
          category?: Database["public"]["Enums"]["equipment_category"]
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      event_partners: {
        Row: {
          category: string | null
          created_at: string
          edition_id: string
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          sort_order: number
          updated_at: string
          website_url: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          edition_id: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          sort_order?: number
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string
          edition_id?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          sort_order?: number
          updated_at?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_partners_edition_id_fkey"
            columns: ["edition_id"]
            isOneToOne: false
            referencedRelation: "editions"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          city: string | null
          country_code: string | null
          created_at: string
          description: string | null
          id: string
          logo_url: string | null
          management_status: Database["public"]["Enums"]["management_status"]
          name: string
          official_website_url: string | null
          organization_id: string | null
          slug: string
          sport_type: Database["public"]["Enums"]["sport_type"]
          status: Database["public"]["Enums"]["record_status"]
          updated_at: string
        }
        Insert: {
          city?: string | null
          country_code?: string | null
          created_at?: string
          description?: string | null
          id?: string
          logo_url?: string | null
          management_status?: Database["public"]["Enums"]["management_status"]
          name: string
          official_website_url?: string | null
          organization_id?: string | null
          slug: string
          sport_type?: Database["public"]["Enums"]["sport_type"]
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
        }
        Update: {
          city?: string | null
          country_code?: string | null
          created_at?: string
          description?: string | null
          id?: string
          logo_url?: string | null
          management_status?: Database["public"]["Enums"]["management_status"]
          name?: string
          official_website_url?: string | null
          organization_id?: string | null
          slug?: string
          sport_type?: Database["public"]["Enums"]["sport_type"]
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fact_sources: {
        Row: {
          article_label: string | null
          created_at: string
          excerpt: string | null
          fact_version_id: string
          id: string
          is_primary: boolean
          locator: Json
          page_end: number | null
          page_start: number | null
          section_label: string | null
          source_id: string
          source_snapshot_id: string
        }
        Insert: {
          article_label?: string | null
          created_at?: string
          excerpt?: string | null
          fact_version_id: string
          id?: string
          is_primary?: boolean
          locator?: Json
          page_end?: number | null
          page_start?: number | null
          section_label?: string | null
          source_id: string
          source_snapshot_id: string
        }
        Update: {
          article_label?: string | null
          created_at?: string
          excerpt?: string | null
          fact_version_id?: string
          id?: string
          is_primary?: boolean
          locator?: Json
          page_end?: number | null
          page_start?: number | null
          section_label?: string | null
          source_id?: string
          source_snapshot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fact_sources_fact_version_id_fkey"
            columns: ["fact_version_id"]
            isOneToOne: false
            referencedRelation: "race_fact_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fact_sources_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fact_sources_source_snapshot_id_fkey"
            columns: ["source_snapshot_id"]
            isOneToOne: false
            referencedRelation: "source_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      library_templates: {
        Row: {
          created_at: string
          id: string
          name: string
          payload: Json
          template_type: Database["public"]["Enums"]["template_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          payload?: Json
          template_type: Database["public"]["Enums"]["template_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          payload?: Json
          template_type?: Database["public"]["Enums"]["template_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "library_templates_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      nutrition_condition_ranges: {
        Row: {
          caffeine_distribution_weight: number
          carbs_target_g_per_hour: number | null
          created_at: string
          end_elapsed_seconds: number
          hydration_target_ml_per_hour: number | null
          id: string
          nutrition_condition_id: string
          sodium_target_mg_per_hour: number | null
          source: Database["public"]["Enums"]["condition_range_source"]
          source_condition_period_id: string | null
          start_elapsed_seconds: number
        }
        Insert: {
          caffeine_distribution_weight?: number
          carbs_target_g_per_hour?: number | null
          created_at?: string
          end_elapsed_seconds: number
          hydration_target_ml_per_hour?: number | null
          id?: string
          nutrition_condition_id: string
          sodium_target_mg_per_hour?: number | null
          source?: Database["public"]["Enums"]["condition_range_source"]
          source_condition_period_id?: string | null
          start_elapsed_seconds: number
        }
        Update: {
          caffeine_distribution_weight?: number
          carbs_target_g_per_hour?: number | null
          created_at?: string
          end_elapsed_seconds?: number
          hydration_target_ml_per_hour?: number | null
          id?: string
          nutrition_condition_id?: string
          sodium_target_mg_per_hour?: number | null
          source?: Database["public"]["Enums"]["condition_range_source"]
          source_condition_period_id?: string | null
          start_elapsed_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_nutrition_range_condition_period"
            columns: ["source_condition_period_id"]
            isOneToOne: false
            referencedRelation: "condition_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nutrition_condition_ranges_nutrition_condition_id_fkey"
            columns: ["nutrition_condition_id"]
            isOneToOne: false
            referencedRelation: "nutrition_conditions"
            referencedColumns: ["id"]
          },
        ]
      }
      nutrition_conditions: {
        Row: {
          condition_type: Database["public"]["Enums"]["nutrition_condition_type"]
          created_at: string
          enabled: boolean
          id: string
          label: string | null
          nutrition_plan_id: string
        }
        Insert: {
          condition_type: Database["public"]["Enums"]["nutrition_condition_type"]
          created_at?: string
          enabled?: boolean
          id?: string
          label?: string | null
          nutrition_plan_id: string
        }
        Update: {
          condition_type?: Database["public"]["Enums"]["nutrition_condition_type"]
          created_at?: string
          enabled?: boolean
          id?: string
          label?: string | null
          nutrition_plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nutrition_conditions_nutrition_plan_id_fkey"
            columns: ["nutrition_plan_id"]
            isOneToOne: false
            referencedRelation: "nutrition_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      nutrition_plans: {
        Row: {
          caffeine_target_total_mg: number | null
          carbs_target_g_per_hour: number
          confirmed_at: string | null
          created_at: string
          enabled: boolean
          engine_config_version: string | null
          engine_version: string
          generated_at: string
          hydration_target_ml_per_hour: number
          id: string
          input_hash: string | null
          input_snapshot: Json
          last_recalculated_at: string | null
          outing_id: string | null
          race_plan_id: string | null
          reserve_percent: number
          sodium_target_mg_per_hour: number
          updated_at: string
        }
        Insert: {
          caffeine_target_total_mg?: number | null
          carbs_target_g_per_hour: number
          confirmed_at?: string | null
          created_at?: string
          enabled?: boolean
          engine_config_version?: string | null
          engine_version: string
          generated_at?: string
          hydration_target_ml_per_hour: number
          id?: string
          input_hash?: string | null
          input_snapshot?: Json
          last_recalculated_at?: string | null
          outing_id?: string | null
          race_plan_id?: string | null
          reserve_percent?: number
          sodium_target_mg_per_hour: number
          updated_at?: string
        }
        Update: {
          caffeine_target_total_mg?: number | null
          carbs_target_g_per_hour?: number
          confirmed_at?: string | null
          created_at?: string
          enabled?: boolean
          engine_config_version?: string | null
          engine_version?: string
          generated_at?: string
          hydration_target_ml_per_hour?: number
          id?: string
          input_hash?: string | null
          input_snapshot?: Json
          last_recalculated_at?: string | null
          outing_id?: string | null
          race_plan_id?: string | null
          reserve_percent?: number
          sodium_target_mg_per_hour?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nutrition_plans_outing_id_fkey"
            columns: ["outing_id"]
            isOneToOne: false
            referencedRelation: "outings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nutrition_plans_race_plan_id_fkey"
            columns: ["race_plan_id"]
            isOneToOne: false
            referencedRelation: "race_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      nutrition_products: {
        Row: {
          brand: string | null
          caffeine_mg: number
          calories_kcal: number | null
          carbs_g: number
          category: Database["public"]["Enums"]["nutrition_product_category"]
          created_at: string
          hydration_ml: number
          id: string
          name: string
          serving_label: string | null
          serving_quantity: number | null
          serving_unit: string | null
          sodium_mg: number
          source_url: string | null
          status: Database["public"]["Enums"]["nutrition_product_status"]
          updated_at: string
          variant: string | null
          verified_at: string | null
        }
        Insert: {
          brand?: string | null
          caffeine_mg?: number
          calories_kcal?: number | null
          carbs_g?: number
          category: Database["public"]["Enums"]["nutrition_product_category"]
          created_at?: string
          hydration_ml?: number
          id?: string
          name: string
          serving_label?: string | null
          serving_quantity?: number | null
          serving_unit?: string | null
          sodium_mg?: number
          source_url?: string | null
          status?: Database["public"]["Enums"]["nutrition_product_status"]
          updated_at?: string
          variant?: string | null
          verified_at?: string | null
        }
        Update: {
          brand?: string | null
          caffeine_mg?: number
          calories_kcal?: number | null
          carbs_g?: number
          category?: Database["public"]["Enums"]["nutrition_product_category"]
          created_at?: string
          hydration_ml?: number
          id?: string
          name?: string
          serving_label?: string | null
          serving_quantity?: number | null
          serving_unit?: string | null
          sodium_mg?: number
          source_url?: string | null
          status?: Database["public"]["Enums"]["nutrition_product_status"]
          updated_at?: string
          variant?: string | null
          verified_at?: string | null
        }
        Relationships: []
      }
      nutrition_recalculations: {
        Row: {
          applied_at: string | null
          before_snapshot: Json
          created_at: string
          decided_at: string | null
          diff_payload: Json
          engine_config_version: string | null
          engine_version: string
          id: string
          input_hash: string | null
          nutrition_plan_id: string
          proposed_snapshot: Json
          source_condition_proposal_id: string | null
          status: Database["public"]["Enums"]["nutrition_recalculation_status"]
          trigger_reason: string
        }
        Insert: {
          applied_at?: string | null
          before_snapshot: Json
          created_at?: string
          decided_at?: string | null
          diff_payload?: Json
          engine_config_version?: string | null
          engine_version: string
          id?: string
          input_hash?: string | null
          nutrition_plan_id: string
          proposed_snapshot: Json
          source_condition_proposal_id?: string | null
          status?: Database["public"]["Enums"]["nutrition_recalculation_status"]
          trigger_reason: string
        }
        Update: {
          applied_at?: string | null
          before_snapshot?: Json
          created_at?: string
          decided_at?: string | null
          diff_payload?: Json
          engine_config_version?: string | null
          engine_version?: string
          id?: string
          input_hash?: string | null
          nutrition_plan_id?: string
          proposed_snapshot?: Json
          source_condition_proposal_id?: string | null
          status?: Database["public"]["Enums"]["nutrition_recalculation_status"]
          trigger_reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "nutrition_recalculations_nutrition_plan_id_fkey"
            columns: ["nutrition_plan_id"]
            isOneToOne: false
            referencedRelation: "nutrition_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nutrition_recalculations_source_condition_proposal_id_fkey"
            columns: ["source_condition_proposal_id"]
            isOneToOne: false
            referencedRelation: "condition_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      nutrition_waypoint_items: {
        Row: {
          action: Database["public"]["Enums"]["nutrition_action"]
          caffeine_mg: number
          carbs_g: number
          created_at: string
          estimated: boolean
          generic_label: string | null
          hydration_ml: number
          id: string
          is_customized: boolean
          nutrition_waypoint_id: string
          product_label_snapshot: string | null
          product_snapshot: Json
          quantity: number
          sodium_mg: number
          unit: string | null
          user_nutrition_product_id: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["nutrition_action"]
          caffeine_mg?: number
          carbs_g?: number
          created_at?: string
          estimated?: boolean
          generic_label?: string | null
          hydration_ml?: number
          id?: string
          is_customized?: boolean
          nutrition_waypoint_id: string
          product_label_snapshot?: string | null
          product_snapshot?: Json
          quantity?: number
          sodium_mg?: number
          unit?: string | null
          user_nutrition_product_id?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["nutrition_action"]
          caffeine_mg?: number
          carbs_g?: number
          created_at?: string
          estimated?: boolean
          generic_label?: string | null
          hydration_ml?: number
          id?: string
          is_customized?: boolean
          nutrition_waypoint_id?: string
          product_label_snapshot?: string | null
          product_snapshot?: Json
          quantity?: number
          sodium_mg?: number
          unit?: string | null
          user_nutrition_product_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nutrition_waypoint_items_nutrition_waypoint_id_fkey"
            columns: ["nutrition_waypoint_id"]
            isOneToOne: false
            referencedRelation: "nutrition_waypoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nutrition_waypoint_items_user_nutrition_product_id_fkey"
            columns: ["user_nutrition_product_id"]
            isOneToOne: false
            referencedRelation: "user_nutrition_products"
            referencedColumns: ["id"]
          },
        ]
      }
      nutrition_waypoints: {
        Row: {
          created_at: string
          distance_km: number | null
          elapsed_seconds: number
          id: string
          is_customized: boolean
          is_locked: boolean
          label: string
          latitude: number | null
          longitude: number | null
          nutrition_plan_id: string
          origin: Database["public"]["Enums"]["nutrition_waypoint_origin"]
          outing_waypoint_id: string | null
          plan_waypoint_id: string | null
          planned_at: string | null
          route_altitude_m: number | null
          sort_order: number
          stable_key: string
        }
        Insert: {
          created_at?: string
          distance_km?: number | null
          elapsed_seconds: number
          id?: string
          is_customized?: boolean
          is_locked?: boolean
          label: string
          latitude?: number | null
          longitude?: number | null
          nutrition_plan_id: string
          origin: Database["public"]["Enums"]["nutrition_waypoint_origin"]
          outing_waypoint_id?: string | null
          plan_waypoint_id?: string | null
          planned_at?: string | null
          route_altitude_m?: number | null
          sort_order: number
          stable_key: string
        }
        Update: {
          created_at?: string
          distance_km?: number | null
          elapsed_seconds?: number
          id?: string
          is_customized?: boolean
          is_locked?: boolean
          label?: string
          latitude?: number | null
          longitude?: number | null
          nutrition_plan_id?: string
          origin?: Database["public"]["Enums"]["nutrition_waypoint_origin"]
          outing_waypoint_id?: string | null
          plan_waypoint_id?: string | null
          planned_at?: string | null
          route_altitude_m?: number | null
          sort_order?: number
          stable_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "nutrition_waypoints_nutrition_plan_id_fkey"
            columns: ["nutrition_plan_id"]
            isOneToOne: false
            referencedRelation: "nutrition_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nutrition_waypoints_outing_waypoint_id_fkey"
            columns: ["outing_waypoint_id"]
            isOneToOne: false
            referencedRelation: "outing_waypoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nutrition_waypoints_plan_waypoint_id_fkey"
            columns: ["plan_waypoint_id"]
            isOneToOne: false
            referencedRelation: "plan_waypoints"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_adoption_snapshots: {
        Row: {
          activated_count: number
          assistance_count: number
          id: string
          invited_count: number
          metadata: Json
          nutrition_count: number
          plan_count: number
          race_id: string
          snapshot_at: string
        }
        Insert: {
          activated_count?: number
          assistance_count?: number
          id?: string
          invited_count?: number
          metadata?: Json
          nutrition_count?: number
          plan_count?: number
          race_id: string
          snapshot_at?: string
        }
        Update: {
          activated_count?: number
          assistance_count?: number
          id?: string
          invited_count?: number
          metadata?: Json
          nutrition_count?: number
          plan_count?: number
          race_id?: string
          snapshot_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_adoption_snapshots_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          organization_id: string
          role: Database["public"]["Enums"]["organization_member_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          role?: Database["public"]["Enums"]["organization_member_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["organization_member_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          contact_email: string | null
          created_at: string
          id: string
          logo_url: string | null
          name: string
          slug: string
          status: Database["public"]["Enums"]["organization_status"]
          updated_at: string
          website_url: string | null
        }
        Insert: {
          contact_email?: string | null
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          slug: string
          status?: Database["public"]["Enums"]["organization_status"]
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          contact_email?: string | null
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          slug?: string
          status?: Database["public"]["Enums"]["organization_status"]
          updated_at?: string
          website_url?: string | null
        }
        Relationships: []
      }
      organizer_briefs: {
        Row: {
          content: Json
          created_at: string
          created_by_run_id: string | null
          edition_id: string
          generated_at: string
          id: string
          period_label: string | null
          race_id: string | null
          revoked_at: string | null
          share_expires_at: string | null
          share_token_hash: string | null
        }
        Insert: {
          content: Json
          created_at?: string
          created_by_run_id?: string | null
          edition_id: string
          generated_at?: string
          id?: string
          period_label?: string | null
          race_id?: string | null
          revoked_at?: string | null
          share_expires_at?: string | null
          share_token_hash?: string | null
        }
        Update: {
          content?: Json
          created_at?: string
          created_by_run_id?: string | null
          edition_id?: string
          generated_at?: string
          id?: string
          period_label?: string | null
          race_id?: string | null
          revoked_at?: string | null
          share_expires_at?: string | null
          share_token_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizer_briefs_created_by_run_id_fkey"
            columns: ["created_by_run_id"]
            isOneToOne: false
            referencedRelation: "race_intelligence_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizer_briefs_edition_id_fkey"
            columns: ["edition_id"]
            isOneToOne: false
            referencedRelation: "editions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizer_briefs_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      outing_equipment: {
        Row: {
          created_at: string
          custom_label: string | null
          equipment_item_id: string | null
          id: string
          notes: string | null
          outing_id: string
          status: Database["public"]["Enums"]["equipment_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          custom_label?: string | null
          equipment_item_id?: string | null
          id?: string
          notes?: string | null
          outing_id: string
          status?: Database["public"]["Enums"]["equipment_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          custom_label?: string | null
          equipment_item_id?: string | null
          id?: string
          notes?: string | null
          outing_id?: string
          status?: Database["public"]["Enums"]["equipment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outing_equipment_equipment_item_id_fkey"
            columns: ["equipment_item_id"]
            isOneToOne: false
            referencedRelation: "equipment_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outing_equipment_outing_id_fkey"
            columns: ["outing_id"]
            isOneToOne: false
            referencedRelation: "outings"
            referencedColumns: ["id"]
          },
        ]
      }
      outing_feedback: {
        Row: {
          actual_duration_seconds: number | null
          created_at: string
          equipment_feedback: string | null
          notes: string | null
          nutrition_feedback:
            | Database["public"]["Enums"]["nutrition_feedback"]
            | null
          outing_id: string
          overall_feeling: Database["public"]["Enums"]["overall_feeling"] | null
          proposed_race_changes: Json
          updated_at: string
        }
        Insert: {
          actual_duration_seconds?: number | null
          created_at?: string
          equipment_feedback?: string | null
          notes?: string | null
          nutrition_feedback?:
            | Database["public"]["Enums"]["nutrition_feedback"]
            | null
          outing_id: string
          overall_feeling?:
            | Database["public"]["Enums"]["overall_feeling"]
            | null
          proposed_race_changes?: Json
          updated_at?: string
        }
        Update: {
          actual_duration_seconds?: number | null
          created_at?: string
          equipment_feedback?: string | null
          notes?: string | null
          nutrition_feedback?:
            | Database["public"]["Enums"]["nutrition_feedback"]
            | null
          outing_id?: string
          overall_feeling?:
            | Database["public"]["Enums"]["overall_feeling"]
            | null
          proposed_race_changes?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outing_feedback_outing_id_fkey"
            columns: ["outing_id"]
            isOneToOne: true
            referencedRelation: "outings"
            referencedColumns: ["id"]
          },
        ]
      }
      outing_waypoints: {
        Row: {
          altitude_m: number | null
          created_at: string
          distance_km: number
          id: string
          latitude: number | null
          longitude: number | null
          name: string
          outing_id: string
          planned_arrival_at: string | null
          planned_elapsed_seconds: number | null
          point_type: Database["public"]["Enums"]["outing_point_type"]
          sort_order: number
        }
        Insert: {
          altitude_m?: number | null
          created_at?: string
          distance_km: number
          id?: string
          latitude?: number | null
          longitude?: number | null
          name: string
          outing_id: string
          planned_arrival_at?: string | null
          planned_elapsed_seconds?: number | null
          point_type?: Database["public"]["Enums"]["outing_point_type"]
          sort_order: number
        }
        Update: {
          altitude_m?: number | null
          created_at?: string
          distance_km?: number
          id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          outing_id?: string
          planned_arrival_at?: string | null
          planned_elapsed_seconds?: number | null
          point_type?: Database["public"]["Enums"]["outing_point_type"]
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "outing_waypoints_outing_id_fkey"
            columns: ["outing_id"]
            isOneToOne: false
            referencedRelation: "outings"
            referencedColumns: ["id"]
          },
        ]
      }
      outings: {
        Row: {
          created_at: string
          distance_km: number | null
          elevation_gain_m: number | null
          elevation_loss_m: number | null
          geometry: unknown
          gpx_storage_path: string | null
          id: string
          linked_participant_race_id: string | null
          manual_conditions: Json
          name: string
          planned_duration_seconds: number | null
          planned_start_datetime: string | null
          simplified_geometry: unknown
          status: Database["public"]["Enums"]["outing_status"]
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          distance_km?: number | null
          elevation_gain_m?: number | null
          elevation_loss_m?: number | null
          geometry?: unknown
          gpx_storage_path?: string | null
          id?: string
          linked_participant_race_id?: string | null
          manual_conditions?: Json
          name: string
          planned_duration_seconds?: number | null
          planned_start_datetime?: string | null
          simplified_geometry?: unknown
          status?: Database["public"]["Enums"]["outing_status"]
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          distance_km?: number | null
          elevation_gain_m?: number | null
          elevation_loss_m?: number | null
          geometry?: unknown
          gpx_storage_path?: string | null
          id?: string
          linked_participant_race_id?: string | null
          manual_conditions?: Json
          name?: string
          planned_duration_seconds?: number | null
          planned_start_datetime?: string | null
          simplified_geometry?: unknown
          status?: Database["public"]["Enums"]["outing_status"]
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outings_linked_participant_race_id_fkey"
            columns: ["linked_participant_race_id"]
            isOneToOne: false
            referencedRelation: "participant_races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      participant_change_impacts: {
        Row: {
          change_event_id: string
          created_at: string
          id: string
          impacted_module: string
          participant_race_id: string
          reviewed_at: string | null
          seen_at: string | null
          status: Database["public"]["Enums"]["change_impact_status"]
        }
        Insert: {
          change_event_id: string
          created_at?: string
          id?: string
          impacted_module: string
          participant_race_id: string
          reviewed_at?: string | null
          seen_at?: string | null
          status?: Database["public"]["Enums"]["change_impact_status"]
        }
        Update: {
          change_event_id?: string
          created_at?: string
          id?: string
          impacted_module?: string
          participant_race_id?: string
          reviewed_at?: string | null
          seen_at?: string | null
          status?: Database["public"]["Enums"]["change_impact_status"]
        }
        Relationships: [
          {
            foreignKeyName: "participant_change_impacts_change_event_id_fkey"
            columns: ["change_event_id"]
            isOneToOne: false
            referencedRelation: "race_change_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participant_change_impacts_participant_race_id_fkey"
            columns: ["participant_race_id"]
            isOneToOne: false
            referencedRelation: "participant_races"
            referencedColumns: ["id"]
          },
        ]
      }
      participant_equipment: {
        Row: {
          created_at: string
          custom_label: string | null
          equipment_item_id: string | null
          id: string
          notes: string | null
          origin: Database["public"]["Enums"]["equipment_origin"]
          participant_race_id: string
          source_requirement_id: string | null
          status: Database["public"]["Enums"]["equipment_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          custom_label?: string | null
          equipment_item_id?: string | null
          id?: string
          notes?: string | null
          origin?: Database["public"]["Enums"]["equipment_origin"]
          participant_race_id: string
          source_requirement_id?: string | null
          status?: Database["public"]["Enums"]["equipment_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          custom_label?: string | null
          equipment_item_id?: string | null
          id?: string
          notes?: string | null
          origin?: Database["public"]["Enums"]["equipment_origin"]
          participant_race_id?: string
          source_requirement_id?: string | null
          status?: Database["public"]["Enums"]["equipment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "participant_equipment_equipment_item_id_fkey"
            columns: ["equipment_item_id"]
            isOneToOne: false
            referencedRelation: "equipment_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participant_equipment_participant_race_id_fkey"
            columns: ["participant_race_id"]
            isOneToOne: false
            referencedRelation: "participant_races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participant_equipment_source_requirement_id_fkey"
            columns: ["source_requirement_id"]
            isOneToOne: false
            referencedRelation: "race_equipment_requirements"
            referencedColumns: ["id"]
          },
        ]
      }
      participant_import_rows: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          import_id: string
          mapped_data: Json | null
          participant_race_id: string | null
          raw_data: Json
          row_number: number
          status: Database["public"]["Enums"]["import_row_status"]
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          import_id: string
          mapped_data?: Json | null
          participant_race_id?: string | null
          raw_data: Json
          row_number: number
          status?: Database["public"]["Enums"]["import_row_status"]
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          import_id?: string
          mapped_data?: Json | null
          participant_race_id?: string | null
          raw_data?: Json
          row_number?: number
          status?: Database["public"]["Enums"]["import_row_status"]
        }
        Relationships: [
          {
            foreignKeyName: "participant_import_rows_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "participant_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participant_import_rows_participant_race_id_fkey"
            columns: ["participant_race_id"]
            isOneToOne: false
            referencedRelation: "participant_races"
            referencedColumns: ["id"]
          },
        ]
      }
      participant_imports: {
        Row: {
          created_at: string
          created_by_user_id: string | null
          edition_id: string
          id: string
          mapping: Json
          organization_id: string
          status: Database["public"]["Enums"]["import_status"]
          storage_path: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_user_id?: string | null
          edition_id: string
          id?: string
          mapping?: Json
          organization_id: string
          status?: Database["public"]["Enums"]["import_status"]
          storage_path: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string | null
          edition_id?: string
          id?: string
          mapping?: Json
          organization_id?: string
          status?: Database["public"]["Enums"]["import_status"]
          storage_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "participant_imports_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participant_imports_edition_id_fkey"
            columns: ["edition_id"]
            isOneToOne: false
            referencedRelation: "editions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participant_imports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      participant_invitations: {
        Row: {
          activated_at: string | null
          created_at: string
          email: string
          expires_at: string | null
          id: string
          opened_at: string | null
          participant_race_id: string
          sent_at: string | null
          status: Database["public"]["Enums"]["invitation_status"]
          token_hash: string
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          created_at?: string
          email: string
          expires_at?: string | null
          id?: string
          opened_at?: string | null
          participant_race_id: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["invitation_status"]
          token_hash: string
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string | null
          id?: string
          opened_at?: string | null
          participant_race_id?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["invitation_status"]
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "participant_invitations_participant_race_id_fkey"
            columns: ["participant_race_id"]
            isOneToOne: false
            referencedRelation: "participant_races"
            referencedColumns: ["id"]
          },
        ]
      }
      participant_race_settings: {
        Row: {
          assistance_status: Database["public"]["Enums"]["assistance_status"]
          nutrition_enabled: boolean
          nutrition_waypoints_visible: boolean
          participant_race_id: string
          repere_visible: boolean
          target_duration_seconds: number | null
          updated_at: string
        }
        Insert: {
          assistance_status?: Database["public"]["Enums"]["assistance_status"]
          nutrition_enabled?: boolean
          nutrition_waypoints_visible?: boolean
          participant_race_id: string
          repere_visible?: boolean
          target_duration_seconds?: number | null
          updated_at?: string
        }
        Update: {
          assistance_status?: Database["public"]["Enums"]["assistance_status"]
          nutrition_enabled?: boolean
          nutrition_waypoints_visible?: boolean
          participant_race_id?: string
          repere_visible?: boolean
          target_duration_seconds?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "participant_race_settings_participant_race_id_fkey"
            columns: ["participant_race_id"]
            isOneToOne: true
            referencedRelation: "participant_races"
            referencedColumns: ["id"]
          },
        ]
      }
      participant_races: {
        Row: {
          bib_number: string | null
          created_at: string
          external_registration_id: string | null
          first_name_snapshot: string | null
          id: string
          invite_email: string | null
          joined_at: string | null
          last_name_snapshot: string | null
          personal_start_datetime: string | null
          preparation_state: Database["public"]["Enums"]["preparation_state"]
          race_id: string
          registration_source: Database["public"]["Enums"]["registration_source"]
          start_wave_id: string | null
          status: Database["public"]["Enums"]["participant_race_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          bib_number?: string | null
          created_at?: string
          external_registration_id?: string | null
          first_name_snapshot?: string | null
          id?: string
          invite_email?: string | null
          joined_at?: string | null
          last_name_snapshot?: string | null
          personal_start_datetime?: string | null
          preparation_state?: Database["public"]["Enums"]["preparation_state"]
          race_id: string
          registration_source?: Database["public"]["Enums"]["registration_source"]
          start_wave_id?: string | null
          status?: Database["public"]["Enums"]["participant_race_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          bib_number?: string | null
          created_at?: string
          external_registration_id?: string | null
          first_name_snapshot?: string | null
          id?: string
          invite_email?: string | null
          joined_at?: string | null
          last_name_snapshot?: string | null
          personal_start_datetime?: string | null
          preparation_state?: Database["public"]["Enums"]["preparation_state"]
          race_id?: string
          registration_source?: Database["public"]["Enums"]["registration_source"]
          start_wave_id?: string | null
          status?: Database["public"]["Enums"]["participant_race_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "participant_races_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participant_races_start_wave_id_fkey"
            columns: ["start_wave_id"]
            isOneToOne: false
            referencedRelation: "race_start_waves"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participant_races_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_cutoff_statuses: {
        Row: {
          calculated_at: string
          id: string
          margin_seconds: number
          plan_waypoint_id: string
          race_cutoff_id: string
          race_plan_id: string
          status: Database["public"]["Enums"]["cutoff_margin_status"]
        }
        Insert: {
          calculated_at?: string
          id?: string
          margin_seconds: number
          plan_waypoint_id: string
          race_cutoff_id: string
          race_plan_id: string
          status: Database["public"]["Enums"]["cutoff_margin_status"]
        }
        Update: {
          calculated_at?: string
          id?: string
          margin_seconds?: number
          plan_waypoint_id?: string
          race_cutoff_id?: string
          race_plan_id?: string
          status?: Database["public"]["Enums"]["cutoff_margin_status"]
        }
        Relationships: [
          {
            foreignKeyName: "plan_cutoff_statuses_plan_waypoint_id_fkey"
            columns: ["plan_waypoint_id"]
            isOneToOne: false
            referencedRelation: "plan_waypoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_cutoff_statuses_race_cutoff_id_fkey"
            columns: ["race_cutoff_id"]
            isOneToOne: false
            referencedRelation: "race_cutoffs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_cutoff_statuses_race_plan_id_fkey"
            columns: ["race_plan_id"]
            isOneToOne: false
            referencedRelation: "race_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_segments: {
        Row: {
          id: string
          initial_duration_seconds: number
          manual_override: boolean
          planned_duration_seconds: number
          race_plan_id: string
          race_segment_id: string
          sort_order: number
        }
        Insert: {
          id?: string
          initial_duration_seconds: number
          manual_override?: boolean
          planned_duration_seconds: number
          race_plan_id: string
          race_segment_id: string
          sort_order: number
        }
        Update: {
          id?: string
          initial_duration_seconds?: number
          manual_override?: boolean
          planned_duration_seconds?: number
          race_plan_id?: string
          race_segment_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "plan_segments_race_plan_id_fkey"
            columns: ["race_plan_id"]
            isOneToOne: false
            referencedRelation: "race_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_segments_race_segment_id_fkey"
            columns: ["race_segment_id"]
            isOneToOne: false
            referencedRelation: "race_segments"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_version_dependencies: {
        Row: {
          created_at: string
          dependency_key: string | null
          dependency_type: Database["public"]["Enums"]["plan_dependency_type"]
          id: string
          race_fact_version_id: string
          race_plan_id: string
        }
        Insert: {
          created_at?: string
          dependency_key?: string | null
          dependency_type: Database["public"]["Enums"]["plan_dependency_type"]
          id?: string
          race_fact_version_id: string
          race_plan_id: string
        }
        Update: {
          created_at?: string
          dependency_key?: string | null
          dependency_type?: Database["public"]["Enums"]["plan_dependency_type"]
          id?: string
          race_fact_version_id?: string
          race_plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_version_dependencies_race_fact_version_id_fkey"
            columns: ["race_fact_version_id"]
            isOneToOne: false
            referencedRelation: "race_fact_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_version_dependencies_race_plan_id_fkey"
            columns: ["race_plan_id"]
            isOneToOne: false
            referencedRelation: "race_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_waypoints: {
        Row: {
          id: string
          is_locked: boolean
          locked_elapsed_seconds: number | null
          manual_note: string | null
          planned_arrival_at: string | null
          planned_elapsed_seconds: number
          race_plan_id: string
          race_waypoint_id: string
          sort_order: number
          stop_duration_seconds: number
        }
        Insert: {
          id?: string
          is_locked?: boolean
          locked_elapsed_seconds?: number | null
          manual_note?: string | null
          planned_arrival_at?: string | null
          planned_elapsed_seconds: number
          race_plan_id: string
          race_waypoint_id: string
          sort_order: number
          stop_duration_seconds?: number
        }
        Update: {
          id?: string
          is_locked?: boolean
          locked_elapsed_seconds?: number | null
          manual_note?: string | null
          planned_arrival_at?: string | null
          planned_elapsed_seconds?: number
          race_plan_id?: string
          race_waypoint_id?: string
          sort_order?: number
          stop_duration_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "plan_waypoints_race_plan_id_fkey"
            columns: ["race_plan_id"]
            isOneToOne: false
            referencedRelation: "race_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_waypoints_race_waypoint_id_fkey"
            columns: ["race_waypoint_id"]
            isOneToOne: false
            referencedRelation: "race_waypoints"
            referencedColumns: ["id"]
          },
        ]
      }
      pluka_answer_sources: {
        Row: {
          citation_order: number
          created_at: string
          fact_version_id: string | null
          id: string
          message_id: string
          relevance_score: number | null
          source_id: string | null
          source_snapshot_id: string | null
          weather_forecast_point_id: string | null
        }
        Insert: {
          citation_order?: number
          created_at?: string
          fact_version_id?: string | null
          id?: string
          message_id: string
          relevance_score?: number | null
          source_id?: string | null
          source_snapshot_id?: string | null
          weather_forecast_point_id?: string | null
        }
        Update: {
          citation_order?: number
          created_at?: string
          fact_version_id?: string | null
          id?: string
          message_id?: string
          relevance_score?: number | null
          source_id?: string | null
          source_snapshot_id?: string | null
          weather_forecast_point_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pluka_answer_sources_fact_version_id_fkey"
            columns: ["fact_version_id"]
            isOneToOne: false
            referencedRelation: "race_fact_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pluka_answer_sources_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "pluka_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pluka_answer_sources_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pluka_answer_sources_source_snapshot_id_fkey"
            columns: ["source_snapshot_id"]
            isOneToOne: false
            referencedRelation: "source_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pluka_answer_sources_weather_forecast_point_id_fkey"
            columns: ["weather_forecast_point_id"]
            isOneToOne: false
            referencedRelation: "weather_forecast_points"
            referencedColumns: ["id"]
          },
        ]
      }
      pluka_conversations: {
        Row: {
          created_at: string
          id: string
          outing_id: string | null
          participant_race_id: string | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          outing_id?: string | null
          participant_race_id?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          outing_id?: string | null
          participant_race_id?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pluka_conversations_outing_id_fkey"
            columns: ["outing_id"]
            isOneToOne: false
            referencedRelation: "outings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pluka_conversations_participant_race_id_fkey"
            columns: ["participant_race_id"]
            isOneToOne: false
            referencedRelation: "participant_races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pluka_conversations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      pluka_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          normalized_question: string | null
          role: Database["public"]["Enums"]["message_role"]
          theme: string | null
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          normalized_question?: string | null
          role: Database["public"]["Enums"]["message_role"]
          theme?: string | null
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          normalized_question?: string | null
          role?: Database["public"]["Enums"]["message_role"]
          theme?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pluka_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "pluka_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      post_race_review_publications: {
        Row: {
          community_thread_id: string | null
          created_at: string
          id: string
          is_published: boolean
          linked_segment_id: string | null
          linked_waypoint_id: string | null
          published_actual_duration_seconds: number | null
          published_advice_text: string | null
          published_at: string | null
          published_author_name: string | null
          published_overall_feeling:
            | Database["public"]["Enums"]["overall_feeling"]
            | null
          published_plan_accuracy:
            | Database["public"]["Enums"]["plan_accuracy"]
            | null
          published_result_status:
            | Database["public"]["Enums"]["result_status"]
            | null
          review_id: string
          show_finish_time: boolean
          show_first_name: boolean
        }
        Insert: {
          community_thread_id?: string | null
          created_at?: string
          id?: string
          is_published?: boolean
          linked_segment_id?: string | null
          linked_waypoint_id?: string | null
          published_actual_duration_seconds?: number | null
          published_advice_text?: string | null
          published_at?: string | null
          published_author_name?: string | null
          published_overall_feeling?:
            | Database["public"]["Enums"]["overall_feeling"]
            | null
          published_plan_accuracy?:
            | Database["public"]["Enums"]["plan_accuracy"]
            | null
          published_result_status?:
            | Database["public"]["Enums"]["result_status"]
            | null
          review_id: string
          show_finish_time?: boolean
          show_first_name?: boolean
        }
        Update: {
          community_thread_id?: string | null
          created_at?: string
          id?: string
          is_published?: boolean
          linked_segment_id?: string | null
          linked_waypoint_id?: string | null
          published_actual_duration_seconds?: number | null
          published_advice_text?: string | null
          published_at?: string | null
          published_author_name?: string | null
          published_overall_feeling?:
            | Database["public"]["Enums"]["overall_feeling"]
            | null
          published_plan_accuracy?:
            | Database["public"]["Enums"]["plan_accuracy"]
            | null
          published_result_status?:
            | Database["public"]["Enums"]["result_status"]
            | null
          review_id?: string
          show_finish_time?: boolean
          show_first_name?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "post_race_review_publications_community_thread_id_fkey"
            columns: ["community_thread_id"]
            isOneToOne: false
            referencedRelation: "community_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_race_review_publications_linked_segment_id_fkey"
            columns: ["linked_segment_id"]
            isOneToOne: false
            referencedRelation: "race_segments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_race_review_publications_linked_waypoint_id_fkey"
            columns: ["linked_waypoint_id"]
            isOneToOne: false
            referencedRelation: "race_waypoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_race_review_publications_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: true
            referencedRelation: "post_race_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      post_race_reviews: {
        Row: {
          actual_duration_seconds: number | null
          assistance_feedback:
            | Database["public"]["Enums"]["feedback_rating"]
            | null
          change_text: string | null
          created_at: string
          equipment_feedback: string | null
          id: string
          nutrition_feedback:
            | Database["public"]["Enums"]["nutrition_feedback"]
            | null
          overall_feeling: Database["public"]["Enums"]["overall_feeling"] | null
          participant_race_id: string
          plan_accuracy: Database["public"]["Enums"]["plan_accuracy"] | null
          pluka_feedback: string | null
          pluka_helpfulness: number | null
          private_note: string | null
          repeat_same_text: string | null
          result_status: Database["public"]["Enums"]["result_status"]
          updated_at: string
        }
        Insert: {
          actual_duration_seconds?: number | null
          assistance_feedback?:
            | Database["public"]["Enums"]["feedback_rating"]
            | null
          change_text?: string | null
          created_at?: string
          equipment_feedback?: string | null
          id?: string
          nutrition_feedback?:
            | Database["public"]["Enums"]["nutrition_feedback"]
            | null
          overall_feeling?:
            | Database["public"]["Enums"]["overall_feeling"]
            | null
          participant_race_id: string
          plan_accuracy?: Database["public"]["Enums"]["plan_accuracy"] | null
          pluka_feedback?: string | null
          pluka_helpfulness?: number | null
          private_note?: string | null
          repeat_same_text?: string | null
          result_status: Database["public"]["Enums"]["result_status"]
          updated_at?: string
        }
        Update: {
          actual_duration_seconds?: number | null
          assistance_feedback?:
            | Database["public"]["Enums"]["feedback_rating"]
            | null
          change_text?: string | null
          created_at?: string
          equipment_feedback?: string | null
          id?: string
          nutrition_feedback?:
            | Database["public"]["Enums"]["nutrition_feedback"]
            | null
          overall_feeling?:
            | Database["public"]["Enums"]["overall_feeling"]
            | null
          participant_race_id?: string
          plan_accuracy?: Database["public"]["Enums"]["plan_accuracy"] | null
          pluka_feedback?: string | null
          pluka_helpfulness?: number | null
          private_note?: string | null
          repeat_same_text?: string | null
          result_status?: Database["public"]["Enums"]["result_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_race_reviews_participant_race_id_fkey"
            columns: ["participant_race_id"]
            isOneToOne: true
            referencedRelation: "participant_races"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          amount_minor: number | null
          created_at: string
          currency: string | null
          entitlement_id: string | null
          id: string
          metadata: Json
          paid_at: string | null
          participant_race_id: string | null
          product_key: string
          provider: string
          provider_checkout_reference: string | null
          provider_customer_reference: string | null
          provider_payment_reference: string | null
          refunded_at: string | null
          status: Database["public"]["Enums"]["purchase_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_minor?: number | null
          created_at?: string
          currency?: string | null
          entitlement_id?: string | null
          id?: string
          metadata?: Json
          paid_at?: string | null
          participant_race_id?: string | null
          product_key: string
          provider: string
          provider_checkout_reference?: string | null
          provider_customer_reference?: string | null
          provider_payment_reference?: string | null
          refunded_at?: string | null
          status?: Database["public"]["Enums"]["purchase_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_minor?: number | null
          created_at?: string
          currency?: string | null
          entitlement_id?: string | null
          id?: string
          metadata?: Json
          paid_at?: string | null
          participant_race_id?: string | null
          product_key?: string
          provider?: string
          provider_checkout_reference?: string | null
          provider_customer_reference?: string | null
          provider_payment_reference?: string | null
          refunded_at?: string | null
          status?: Database["public"]["Enums"]["purchase_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchases_entitlement_id_fkey"
            columns: ["entitlement_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_participant_race_id_fkey"
            columns: ["participant_race_id"]
            isOneToOne: false
            referencedRelation: "participant_races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      question_insight_snapshots: {
        Row: {
          generated_at: string
          id: string
          normalized_question: string | null
          official_answer_available: boolean
          official_answer_fact_id: string | null
          participant_count: number
          race_id: string
          theme: string
          window_end: string
          window_start: string
        }
        Insert: {
          generated_at?: string
          id?: string
          normalized_question?: string | null
          official_answer_available?: boolean
          official_answer_fact_id?: string | null
          participant_count: number
          race_id: string
          theme: string
          window_end: string
          window_start: string
        }
        Update: {
          generated_at?: string
          id?: string
          normalized_question?: string | null
          official_answer_available?: boolean
          official_answer_fact_id?: string | null
          participant_count?: number
          race_id?: string
          theme?: string
          window_end?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_insight_snapshots_official_answer_fact_id_fkey"
            columns: ["official_answer_fact_id"]
            isOneToOne: false
            referencedRelation: "race_facts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_insight_snapshots_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      race_aid_station_items: {
        Row: {
          availability_notes: string | null
          created_at: string
          estimated_portion_label: string | null
          fact_id: string | null
          id: string
          label: string
          nutrition_product_id: string | null
          race_waypoint_id: string
          sort_order: number
        }
        Insert: {
          availability_notes?: string | null
          created_at?: string
          estimated_portion_label?: string | null
          fact_id?: string | null
          id?: string
          label: string
          nutrition_product_id?: string | null
          race_waypoint_id: string
          sort_order?: number
        }
        Update: {
          availability_notes?: string | null
          created_at?: string
          estimated_portion_label?: string | null
          fact_id?: string | null
          id?: string
          label?: string
          nutrition_product_id?: string | null
          race_waypoint_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "race_aid_station_items_fact_id_fkey"
            columns: ["fact_id"]
            isOneToOne: false
            referencedRelation: "race_facts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_aid_station_items_nutrition_product_id_fkey"
            columns: ["nutrition_product_id"]
            isOneToOne: false
            referencedRelation: "nutrition_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_aid_station_items_race_waypoint_id_fkey"
            columns: ["race_waypoint_id"]
            isOneToOne: false
            referencedRelation: "race_waypoints"
            referencedColumns: ["id"]
          },
        ]
      }
      race_assistance_rules: {
        Row: {
          access_notes: string | null
          allowed: boolean
          fact_id: string | null
          id: string
          parking_notes: string | null
          race_id: string
          race_waypoint_id: string | null
          zone_description: string | null
        }
        Insert: {
          access_notes?: string | null
          allowed: boolean
          fact_id?: string | null
          id?: string
          parking_notes?: string | null
          race_id: string
          race_waypoint_id?: string | null
          zone_description?: string | null
        }
        Update: {
          access_notes?: string | null
          allowed?: boolean
          fact_id?: string | null
          id?: string
          parking_notes?: string | null
          race_id?: string
          race_waypoint_id?: string | null
          zone_description?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "race_assistance_rules_fact_id_fkey"
            columns: ["fact_id"]
            isOneToOne: false
            referencedRelation: "race_facts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_assistance_rules_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_assistance_rules_race_waypoint_id_fkey"
            columns: ["race_waypoint_id"]
            isOneToOne: false
            referencedRelation: "race_waypoints"
            referencedColumns: ["id"]
          },
        ]
      }
      race_assistants: {
        Row: {
          created_at: string
          email: string | null
          first_name: string
          id: string
          last_name: string | null
          participant_race_id: string
          phone: string | null
          status: Database["public"]["Enums"]["assistant_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          first_name: string
          id?: string
          last_name?: string | null
          participant_race_id: string
          phone?: string | null
          status?: Database["public"]["Enums"]["assistant_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          first_name?: string
          id?: string
          last_name?: string | null
          participant_race_id?: string
          phone?: string | null
          status?: Database["public"]["Enums"]["assistant_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_assistants_participant_race_id_fkey"
            columns: ["participant_race_id"]
            isOneToOne: false
            referencedRelation: "participant_races"
            referencedColumns: ["id"]
          },
        ]
      }
      race_change_events: {
        Row: {
          created_at: string
          fact_id: string
          from_version_id: string | null
          id: string
          published_at: string
          published_by_organization_id: string | null
          published_by_user_id: string | null
          race_id: string
          severity: Database["public"]["Enums"]["change_severity"]
          summary: string | null
          title: string
          to_version_id: string
        }
        Insert: {
          created_at?: string
          fact_id: string
          from_version_id?: string | null
          id?: string
          published_at?: string
          published_by_organization_id?: string | null
          published_by_user_id?: string | null
          race_id: string
          severity?: Database["public"]["Enums"]["change_severity"]
          summary?: string | null
          title: string
          to_version_id: string
        }
        Update: {
          created_at?: string
          fact_id?: string
          from_version_id?: string | null
          id?: string
          published_at?: string
          published_by_organization_id?: string | null
          published_by_user_id?: string | null
          race_id?: string
          severity?: Database["public"]["Enums"]["change_severity"]
          summary?: string | null
          title?: string
          to_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_change_events_fact_id_fkey"
            columns: ["fact_id"]
            isOneToOne: false
            referencedRelation: "race_facts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_change_events_from_version_id_fkey"
            columns: ["from_version_id"]
            isOneToOne: false
            referencedRelation: "race_fact_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_change_events_published_by_organization_id_fkey"
            columns: ["published_by_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_change_events_published_by_user_id_fkey"
            columns: ["published_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_change_events_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_change_events_to_version_id_fkey"
            columns: ["to_version_id"]
            isOneToOne: false
            referencedRelation: "race_fact_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      race_course_geometries: {
        Row: {
          geometry: unknown
          id: string
          length_m: number | null
          point_count: number
          processed_at: string
          processor_version: string
          race_id: string
          simplified_geometry: unknown
          source_snapshot_id: string | null
          version_number: number
        }
        Insert: {
          geometry: unknown
          id?: string
          length_m?: number | null
          point_count: number
          processed_at?: string
          processor_version: string
          race_id: string
          simplified_geometry?: unknown
          source_snapshot_id?: string | null
          version_number?: number
        }
        Update: {
          geometry?: unknown
          id?: string
          length_m?: number | null
          point_count?: number
          processed_at?: string
          processor_version?: string
          race_id?: string
          simplified_geometry?: unknown
          source_snapshot_id?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "race_course_geometries_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_course_geometries_source_snapshot_id_fkey"
            columns: ["source_snapshot_id"]
            isOneToOne: false
            referencedRelation: "source_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      race_cutoffs: {
        Row: {
          cutoff_datetime: string
          cutoff_type: Database["public"]["Enums"]["cutoff_type"]
          description: string | null
          fact_id: string | null
          id: string
          race_id: string
          race_waypoint_id: string
        }
        Insert: {
          cutoff_datetime: string
          cutoff_type?: Database["public"]["Enums"]["cutoff_type"]
          description?: string | null
          fact_id?: string | null
          id?: string
          race_id: string
          race_waypoint_id: string
        }
        Update: {
          cutoff_datetime?: string
          cutoff_type?: Database["public"]["Enums"]["cutoff_type"]
          description?: string | null
          fact_id?: string | null
          id?: string
          race_id?: string
          race_waypoint_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_cutoffs_fact_id_fkey"
            columns: ["fact_id"]
            isOneToOne: false
            referencedRelation: "race_facts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_cutoffs_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_cutoffs_race_waypoint_id_fkey"
            columns: ["race_waypoint_id"]
            isOneToOne: false
            referencedRelation: "race_waypoints"
            referencedColumns: ["id"]
          },
        ]
      }
      race_equipment_requirements: {
        Row: {
          condition_text: string | null
          description: string | null
          equipment_item_id: string
          fact_id: string | null
          id: string
          race_id: string
          requirement_type: Database["public"]["Enums"]["requirement_type"]
        }
        Insert: {
          condition_text?: string | null
          description?: string | null
          equipment_item_id: string
          fact_id?: string | null
          id?: string
          race_id: string
          requirement_type: Database["public"]["Enums"]["requirement_type"]
        }
        Update: {
          condition_text?: string | null
          description?: string | null
          equipment_item_id?: string
          fact_id?: string | null
          id?: string
          race_id?: string
          requirement_type?: Database["public"]["Enums"]["requirement_type"]
        }
        Relationships: [
          {
            foreignKeyName: "race_equipment_requirements_equipment_item_id_fkey"
            columns: ["equipment_item_id"]
            isOneToOne: false
            referencedRelation: "equipment_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_equipment_requirements_fact_id_fkey"
            columns: ["fact_id"]
            isOneToOne: false
            referencedRelation: "race_facts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_equipment_requirements_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      race_fact_versions: {
        Row: {
          created_at: string
          created_by_user_id: string | null
          fact_id: string
          id: string
          published_at: string | null
          supersedes_version_id: string | null
          trust_level: Database["public"]["Enums"]["trust_level"]
          unit: string | null
          validated_at: string | null
          validated_by_organization_id: string | null
          validated_by_user_id: string | null
          value_json: Json | null
          value_number: number | null
          value_text: string | null
          version_number: number
          workflow_status: Database["public"]["Enums"]["fact_workflow_status"]
        }
        Insert: {
          created_at?: string
          created_by_user_id?: string | null
          fact_id: string
          id?: string
          published_at?: string | null
          supersedes_version_id?: string | null
          trust_level?: Database["public"]["Enums"]["trust_level"]
          unit?: string | null
          validated_at?: string | null
          validated_by_organization_id?: string | null
          validated_by_user_id?: string | null
          value_json?: Json | null
          value_number?: number | null
          value_text?: string | null
          version_number: number
          workflow_status?: Database["public"]["Enums"]["fact_workflow_status"]
        }
        Update: {
          created_at?: string
          created_by_user_id?: string | null
          fact_id?: string
          id?: string
          published_at?: string | null
          supersedes_version_id?: string | null
          trust_level?: Database["public"]["Enums"]["trust_level"]
          unit?: string | null
          validated_at?: string | null
          validated_by_organization_id?: string | null
          validated_by_user_id?: string | null
          value_json?: Json | null
          value_number?: number | null
          value_text?: string | null
          version_number?: number
          workflow_status?: Database["public"]["Enums"]["fact_workflow_status"]
        }
        Relationships: [
          {
            foreignKeyName: "race_fact_versions_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_fact_versions_fact_id_fkey"
            columns: ["fact_id"]
            isOneToOne: false
            referencedRelation: "race_facts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_fact_versions_supersedes_version_id_fkey"
            columns: ["supersedes_version_id"]
            isOneToOne: false
            referencedRelation: "race_fact_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_fact_versions_validated_by_organization_id_fkey"
            columns: ["validated_by_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_fact_versions_validated_by_user_id_fkey"
            columns: ["validated_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      race_facts: {
        Row: {
          archived_at: string | null
          category: Database["public"]["Enums"]["fact_category"]
          created_at: string
          current_version_id: string | null
          fact_key: string
          id: string
          race_id: string
        }
        Insert: {
          archived_at?: string | null
          category: Database["public"]["Enums"]["fact_category"]
          created_at?: string
          current_version_id?: string | null
          fact_key: string
          id?: string
          race_id: string
        }
        Update: {
          archived_at?: string | null
          category?: Database["public"]["Enums"]["fact_category"]
          created_at?: string
          current_version_id?: string | null
          fact_key?: string
          id?: string
          race_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_race_facts_current_version"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "race_fact_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_facts_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      race_intelligence_cutoff_summaries: {
        Row: {
          created_at: string
          id: string
          margin_buckets: Json
          participant_count: number
          race_cutoff_id: string
          run_id: string
          sensitivity: Database["public"]["Enums"]["sensitivity_label"]
          wave_breakdown: Json
        }
        Insert: {
          created_at?: string
          id?: string
          margin_buckets?: Json
          participant_count: number
          race_cutoff_id: string
          run_id: string
          sensitivity?: Database["public"]["Enums"]["sensitivity_label"]
          wave_breakdown?: Json
        }
        Update: {
          created_at?: string
          id?: string
          margin_buckets?: Json
          participant_count?: number
          race_cutoff_id?: string
          run_id?: string
          sensitivity?: Database["public"]["Enums"]["sensitivity_label"]
          wave_breakdown?: Json
        }
        Relationships: [
          {
            foreignKeyName: "race_intelligence_cutoff_summaries_race_cutoff_id_fkey"
            columns: ["race_cutoff_id"]
            isOneToOne: false
            referencedRelation: "race_cutoffs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_intelligence_cutoff_summaries_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "race_intelligence_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      race_intelligence_runs: {
        Row: {
          algorithm_version: string | null
          calibration_version: string | null
          completed_at: string | null
          config_version: string | null
          coverage_label: Database["public"]["Enums"]["coverage_label"] | null
          coverage_pct: number | null
          created_at: string
          generic_estimate_count: number | null
          id: string
          input_hash: string | null
          input_snapshot: Json
          mode: Database["public"]["Enums"]["race_intelligence_mode"]
          participant_count: number | null
          pluka_plan_count: number | null
          primary_performance_provider:
            | Database["public"]["Enums"]["enrichment_provider"]
            | null
          race_id: string
          readiness: Json
          started_at: string | null
          status: Database["public"]["Enums"]["race_intelligence_status"]
          usable_signal_count: number | null
        }
        Insert: {
          algorithm_version?: string | null
          calibration_version?: string | null
          completed_at?: string | null
          config_version?: string | null
          coverage_label?: Database["public"]["Enums"]["coverage_label"] | null
          coverage_pct?: number | null
          created_at?: string
          generic_estimate_count?: number | null
          id?: string
          input_hash?: string | null
          input_snapshot?: Json
          mode?: Database["public"]["Enums"]["race_intelligence_mode"]
          participant_count?: number | null
          pluka_plan_count?: number | null
          primary_performance_provider?:
            | Database["public"]["Enums"]["enrichment_provider"]
            | null
          race_id: string
          readiness?: Json
          started_at?: string | null
          status?: Database["public"]["Enums"]["race_intelligence_status"]
          usable_signal_count?: number | null
        }
        Update: {
          algorithm_version?: string | null
          calibration_version?: string | null
          completed_at?: string | null
          config_version?: string | null
          coverage_label?: Database["public"]["Enums"]["coverage_label"] | null
          coverage_pct?: number | null
          created_at?: string
          generic_estimate_count?: number | null
          id?: string
          input_hash?: string | null
          input_snapshot?: Json
          mode?: Database["public"]["Enums"]["race_intelligence_mode"]
          participant_count?: number | null
          pluka_plan_count?: number | null
          primary_performance_provider?:
            | Database["public"]["Enums"]["enrichment_provider"]
            | null
          race_id?: string
          readiness?: Json
          started_at?: string | null
          status?: Database["public"]["Enums"]["race_intelligence_status"]
          usable_signal_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "race_intelligence_runs_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      race_intelligence_wave_summaries: {
        Row: {
          coverage_pct: number | null
          dispersion_label:
            | Database["public"]["Enums"]["dispersion_label"]
            | null
          id: string
          metrics: Json
          participant_count: number
          run_id: string
          start_wave_id: string
        }
        Insert: {
          coverage_pct?: number | null
          dispersion_label?:
            | Database["public"]["Enums"]["dispersion_label"]
            | null
          id?: string
          metrics?: Json
          participant_count: number
          run_id: string
          start_wave_id: string
        }
        Update: {
          coverage_pct?: number | null
          dispersion_label?:
            | Database["public"]["Enums"]["dispersion_label"]
            | null
          id?: string
          metrics?: Json
          participant_count?: number
          run_id?: string
          start_wave_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_intelligence_wave_summaries_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "race_intelligence_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_intelligence_wave_summaries_start_wave_id_fkey"
            columns: ["start_wave_id"]
            isOneToOne: false
            referencedRelation: "race_start_waves"
            referencedColumns: ["id"]
          },
        ]
      }
      race_intelligence_waypoint_flows: {
        Row: {
          bucket_minutes: number
          coverage_pct: number | null
          created_at: string
          expected_count: number
          id: string
          lower_estimate: number | null
          modeled_count: number | null
          race_waypoint_id: string
          run_id: string
          time_bucket_start: string
          upper_estimate: number | null
          wave_breakdown: Json
        }
        Insert: {
          bucket_minutes?: number
          coverage_pct?: number | null
          created_at?: string
          expected_count: number
          id?: string
          lower_estimate?: number | null
          modeled_count?: number | null
          race_waypoint_id: string
          run_id: string
          time_bucket_start: string
          upper_estimate?: number | null
          wave_breakdown?: Json
        }
        Update: {
          bucket_minutes?: number
          coverage_pct?: number | null
          created_at?: string
          expected_count?: number
          id?: string
          lower_estimate?: number | null
          modeled_count?: number | null
          race_waypoint_id?: string
          run_id?: string
          time_bucket_start?: string
          upper_estimate?: number | null
          wave_breakdown?: Json
        }
        Relationships: [
          {
            foreignKeyName: "race_intelligence_waypoint_flows_race_waypoint_id_fkey"
            columns: ["race_waypoint_id"]
            isOneToOne: false
            referencedRelation: "race_waypoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_intelligence_waypoint_flows_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "race_intelligence_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      race_intelligence_weather_exposures: {
        Row: {
          condition_type: Database["public"]["Enums"]["detected_condition_type"]
          coverage_pct: number | null
          created_at: string
          end_datetime: string
          expected_exposed_count: number | null
          expected_exposed_pct: number
          id: string
          lower_exposed_count: number | null
          modeled_participant_count: number | null
          provider: string | null
          provider_updated_at: string | null
          race_segment_id: string | null
          race_waypoint_id: string | null
          run_id: string
          start_datetime: string
          upper_exposed_count: number | null
          wave_breakdown: Json
          weather_summary: Json
        }
        Insert: {
          condition_type: Database["public"]["Enums"]["detected_condition_type"]
          coverage_pct?: number | null
          created_at?: string
          end_datetime: string
          expected_exposed_count?: number | null
          expected_exposed_pct: number
          id?: string
          lower_exposed_count?: number | null
          modeled_participant_count?: number | null
          provider?: string | null
          provider_updated_at?: string | null
          race_segment_id?: string | null
          race_waypoint_id?: string | null
          run_id: string
          start_datetime: string
          upper_exposed_count?: number | null
          wave_breakdown?: Json
          weather_summary?: Json
        }
        Update: {
          condition_type?: Database["public"]["Enums"]["detected_condition_type"]
          coverage_pct?: number | null
          created_at?: string
          end_datetime?: string
          expected_exposed_count?: number | null
          expected_exposed_pct?: number
          id?: string
          lower_exposed_count?: number | null
          modeled_participant_count?: number | null
          provider?: string | null
          provider_updated_at?: string | null
          race_segment_id?: string | null
          race_waypoint_id?: string | null
          run_id?: string
          start_datetime?: string
          upper_exposed_count?: number | null
          wave_breakdown?: Json
          weather_summary?: Json
        }
        Relationships: [
          {
            foreignKeyName: "race_intelligence_weather_exposures_race_segment_id_fkey"
            columns: ["race_segment_id"]
            isOneToOne: false
            referencedRelation: "race_segments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_intelligence_weather_exposures_race_waypoint_id_fkey"
            columns: ["race_waypoint_id"]
            isOneToOne: false
            referencedRelation: "race_waypoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_intelligence_weather_exposures_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "race_intelligence_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      race_notices: {
        Row: {
          archived_at: string | null
          body: string
          created_at: string
          effective_from: string | null
          effective_until: string | null
          id: string
          linked_fact_version_id: string | null
          notice_type: Database["public"]["Enums"]["notice_type"]
          published_at: string
          published_by_organization_id: string | null
          published_by_user_id: string | null
          race_id: string
          severity: Database["public"]["Enums"]["notice_severity"]
          title: string
          trust_level: Database["public"]["Enums"]["trust_level"]
        }
        Insert: {
          archived_at?: string | null
          body: string
          created_at?: string
          effective_from?: string | null
          effective_until?: string | null
          id?: string
          linked_fact_version_id?: string | null
          notice_type: Database["public"]["Enums"]["notice_type"]
          published_at?: string
          published_by_organization_id?: string | null
          published_by_user_id?: string | null
          race_id: string
          severity?: Database["public"]["Enums"]["notice_severity"]
          title: string
          trust_level?: Database["public"]["Enums"]["trust_level"]
        }
        Update: {
          archived_at?: string | null
          body?: string
          created_at?: string
          effective_from?: string | null
          effective_until?: string | null
          id?: string
          linked_fact_version_id?: string | null
          notice_type?: Database["public"]["Enums"]["notice_type"]
          published_at?: string
          published_by_organization_id?: string | null
          published_by_user_id?: string | null
          race_id?: string
          severity?: Database["public"]["Enums"]["notice_severity"]
          title?: string
          trust_level?: Database["public"]["Enums"]["trust_level"]
        }
        Relationships: [
          {
            foreignKeyName: "race_notices_linked_fact_version_id_fkey"
            columns: ["linked_fact_version_id"]
            isOneToOne: false
            referencedRelation: "race_fact_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_notices_published_by_organization_id_fkey"
            columns: ["published_by_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_notices_published_by_user_id_fkey"
            columns: ["published_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_notices_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      race_plans: {
        Row: {
          engine_version: string
          generated_at: string
          id: string
          initial_target_duration_seconds: number
          input_hash: string | null
          input_snapshot: Json
          participant_race_id: string
          planned_finish_datetime: string | null
          status: Database["public"]["Enums"]["plan_status"]
          target_duration_seconds: number
          updated_at: string
          version: number
        }
        Insert: {
          engine_version: string
          generated_at?: string
          id?: string
          initial_target_duration_seconds: number
          input_hash?: string | null
          input_snapshot?: Json
          participant_race_id: string
          planned_finish_datetime?: string | null
          status?: Database["public"]["Enums"]["plan_status"]
          target_duration_seconds: number
          updated_at?: string
          version: number
        }
        Update: {
          engine_version?: string
          generated_at?: string
          id?: string
          initial_target_duration_seconds?: number
          input_hash?: string | null
          input_snapshot?: Json
          participant_race_id?: string
          planned_finish_datetime?: string | null
          status?: Database["public"]["Enums"]["plan_status"]
          target_duration_seconds?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "race_plans_participant_race_id_fkey"
            columns: ["participant_race_id"]
            isOneToOne: false
            referencedRelation: "participant_races"
            referencedColumns: ["id"]
          },
        ]
      }
      race_segments: {
        Row: {
          average_grade_pct: number | null
          distance_km: number
          elevation_gain_m: number | null
          elevation_loss_m: number | null
          from_waypoint_id: string
          id: string
          max_altitude_m: number | null
          min_altitude_m: number | null
          race_id: string
          segment_type: Database["public"]["Enums"]["segment_type"]
          sort_order: number
          technicality_level: number | null
          to_waypoint_id: string
        }
        Insert: {
          average_grade_pct?: number | null
          distance_km: number
          elevation_gain_m?: number | null
          elevation_loss_m?: number | null
          from_waypoint_id: string
          id?: string
          max_altitude_m?: number | null
          min_altitude_m?: number | null
          race_id: string
          segment_type?: Database["public"]["Enums"]["segment_type"]
          sort_order: number
          technicality_level?: number | null
          to_waypoint_id: string
        }
        Update: {
          average_grade_pct?: number | null
          distance_km?: number
          elevation_gain_m?: number | null
          elevation_loss_m?: number | null
          from_waypoint_id?: string
          id?: string
          max_altitude_m?: number | null
          min_altitude_m?: number | null
          race_id?: string
          segment_type?: Database["public"]["Enums"]["segment_type"]
          sort_order?: number
          technicality_level?: number | null
          to_waypoint_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_segments_from_waypoint_id_fkey"
            columns: ["from_waypoint_id"]
            isOneToOne: false
            referencedRelation: "race_waypoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_segments_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_segments_to_waypoint_id_fkey"
            columns: ["to_waypoint_id"]
            isOneToOne: false
            referencedRelation: "race_waypoints"
            referencedColumns: ["id"]
          },
        ]
      }
      race_start_waves: {
        Row: {
          fact_id: string | null
          id: string
          max_participants: number | null
          name: string
          race_id: string
          sort_order: number
          start_datetime: string
        }
        Insert: {
          fact_id?: string | null
          id?: string
          max_participants?: number | null
          name: string
          race_id: string
          sort_order?: number
          start_datetime: string
        }
        Update: {
          fact_id?: string | null
          id?: string
          max_participants?: number | null
          name?: string
          race_id?: string
          sort_order?: number
          start_datetime?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_race_start_waves_fact"
            columns: ["fact_id"]
            isOneToOne: false
            referencedRelation: "race_facts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_start_waves_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      race_status_transitions: {
        Row: {
          actor_user_id: string | null
          created_at: string
          from_status: Database["public"]["Enums"]["race_status"]
          id: string
          race_id: string
          to_status: Database["public"]["Enums"]["race_status"]
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          from_status: Database["public"]["Enums"]["race_status"]
          id?: string
          race_id: string
          to_status: Database["public"]["Enums"]["race_status"]
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["race_status"]
          id?: string
          race_id?: string
          to_status?: Database["public"]["Enums"]["race_status"]
        }
        Relationships: [
          {
            foreignKeyName: "race_status_transitions_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_status_transitions_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      race_waypoints: {
        Row: {
          altitude_m: number | null
          created_at: string
          distance_km: number
          elevation_gain_cumulative_m: number | null
          elevation_loss_cumulative_m: number | null
          fact_id: string | null
          gpx_offset_m: number | null
          id: string
          latitude: number | null
          longitude: number | null
          name: string
          race_id: string
          sort_order: number
          updated_at: string
          waypoint_type: Database["public"]["Enums"]["waypoint_type"]
        }
        Insert: {
          altitude_m?: number | null
          created_at?: string
          distance_km: number
          elevation_gain_cumulative_m?: number | null
          elevation_loss_cumulative_m?: number | null
          fact_id?: string | null
          gpx_offset_m?: number | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name: string
          race_id: string
          sort_order: number
          updated_at?: string
          waypoint_type: Database["public"]["Enums"]["waypoint_type"]
        }
        Update: {
          altitude_m?: number | null
          created_at?: string
          distance_km?: number
          elevation_gain_cumulative_m?: number | null
          elevation_loss_cumulative_m?: number | null
          fact_id?: string | null
          gpx_offset_m?: number | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          race_id?: string
          sort_order?: number
          updated_at?: string
          waypoint_type?: Database["public"]["Enums"]["waypoint_type"]
        }
        Relationships: [
          {
            foreignKeyName: "fk_race_waypoints_fact"
            columns: ["fact_id"]
            isOneToOne: false
            referencedRelation: "race_facts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_waypoints_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      races: {
        Row: {
          created_at: string
          current_course_geometry_id: string | null
          cutoff_datetime: string | null
          description: string | null
          distance_km: number
          edition_id: string
          elevation_gain_m: number | null
          elevation_loss_m: number | null
          finish_location_name: string | null
          gpx_source_id: string | null
          id: string
          name: string
          public_visibility: Database["public"]["Enums"]["race_visibility"]
          slug: string
          start_datetime: string
          start_location_name: string | null
          status: Database["public"]["Enums"]["race_status"]
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_course_geometry_id?: string | null
          cutoff_datetime?: string | null
          description?: string | null
          distance_km: number
          edition_id: string
          elevation_gain_m?: number | null
          elevation_loss_m?: number | null
          finish_location_name?: string | null
          gpx_source_id?: string | null
          id?: string
          name: string
          public_visibility?: Database["public"]["Enums"]["race_visibility"]
          slug: string
          start_datetime: string
          start_location_name?: string | null
          status?: Database["public"]["Enums"]["race_status"]
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_course_geometry_id?: string | null
          cutoff_datetime?: string | null
          description?: string | null
          distance_km?: number
          edition_id?: string
          elevation_gain_m?: number | null
          elevation_loss_m?: number | null
          finish_location_name?: string | null
          gpx_source_id?: string | null
          id?: string
          name?: string
          public_visibility?: Database["public"]["Enums"]["race_visibility"]
          slug?: string
          start_datetime?: string
          start_location_name?: string | null
          status?: Database["public"]["Enums"]["race_status"]
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "races_current_course_geometry_id_fkey"
            columns: ["current_course_geometry_id"]
            isOneToOne: false
            referencedRelation: "race_course_geometries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "races_edition_id_fkey"
            columns: ["edition_id"]
            isOneToOne: false
            referencedRelation: "editions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "races_gpx_source_id_fkey"
            columns: ["gpx_source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      source_race_scopes: {
        Row: {
          race_id: string
          source_id: string
        }
        Insert: {
          race_id: string
          source_id: string
        }
        Update: {
          race_id?: string
          source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_race_scopes_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_race_scopes_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      source_snapshots: {
        Row: {
          content_hash: string
          content_type: string | null
          final_url: string | null
          http_status: number | null
          id: string
          metadata: Json
          retrieved_at: string
          size_bytes: number | null
          snapshot_storage_path: string | null
          source_id: string
          version_number: number
        }
        Insert: {
          content_hash: string
          content_type?: string | null
          final_url?: string | null
          http_status?: number | null
          id?: string
          metadata?: Json
          retrieved_at?: string
          size_bytes?: number | null
          snapshot_storage_path?: string | null
          source_id: string
          version_number: number
        }
        Update: {
          content_hash?: string
          content_type?: string | null
          final_url?: string | null
          http_status?: number | null
          id?: string
          metadata?: Json
          retrieved_at?: string
          size_bytes?: number | null
          snapshot_storage_path?: string | null
          source_id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "source_snapshots_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      sources: {
        Row: {
          created_at: string
          created_by_user_id: string | null
          current_snapshot_id: string | null
          declared_published_at: string | null
          edition_id: string
          id: string
          imported_at: string
          organization_id: string | null
          source_type: Database["public"]["Enums"]["source_type"]
          status: Database["public"]["Enums"]["source_status"]
          storage_path: string | null
          title: string
          updated_at: string
          url: string | null
        }
        Insert: {
          created_at?: string
          created_by_user_id?: string | null
          current_snapshot_id?: string | null
          declared_published_at?: string | null
          edition_id: string
          id?: string
          imported_at?: string
          organization_id?: string | null
          source_type: Database["public"]["Enums"]["source_type"]
          status?: Database["public"]["Enums"]["source_status"]
          storage_path?: string | null
          title: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          created_at?: string
          created_by_user_id?: string | null
          current_snapshot_id?: string | null
          declared_published_at?: string | null
          edition_id?: string
          id?: string
          imported_at?: string
          organization_id?: string | null
          source_type?: Database["public"]["Enums"]["source_type"]
          status?: Database["public"]["Enums"]["source_status"]
          storage_path?: string | null
          title?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_sources_current_snapshot"
            columns: ["current_snapshot_id"]
            isOneToOne: false
            referencedRelation: "source_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sources_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sources_edition_id_fkey"
            columns: ["edition_id"]
            isOneToOne: false
            referencedRelation: "editions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sources_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          completed_at: string | null
          created_at: string
          description: string | null
          due_at: string | null
          id: string
          origin: Database["public"]["Enums"]["task_origin"]
          participant_race_id: string
          source_change_event_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          origin?: Database["public"]["Enums"]["task_origin"]
          participant_race_id: string
          source_change_event_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          origin?: Database["public"]["Enums"]["task_origin"]
          participant_race_id?: string
          source_change_event_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_participant_race_id_fkey"
            columns: ["participant_race_id"]
            isOneToOne: false
            referencedRelation: "participant_races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_source_change_event_id_fkey"
            columns: ["source_change_event_id"]
            isOneToOne: false
            referencedRelation: "race_change_events"
            referencedColumns: ["id"]
          },
        ]
      }
      trail_profiles: {
        Row: {
          climb_comfort: Database["public"]["Enums"]["profile_comfort"] | null
          created_at: string
          descent_comfort: Database["public"]["Enums"]["profile_comfort"] | null
          fallback_trail_pace_seconds_per_km: number | null
          long_distance_experience:
            | Database["public"]["Enums"]["long_distance_experience"]
            | null
          profile_completed_at: string | null
          representative_distance_km: number | null
          representative_duration_seconds: number | null
          representative_effort_date: string | null
          representative_effort_label: string | null
          representative_elevation_gain_m: number | null
          updated_at: string
          user_id: string
          weekly_distance_km: number | null
          weekly_elevation_gain_m: number | null
        }
        Insert: {
          climb_comfort?: Database["public"]["Enums"]["profile_comfort"] | null
          created_at?: string
          descent_comfort?:
            | Database["public"]["Enums"]["profile_comfort"]
            | null
          fallback_trail_pace_seconds_per_km?: number | null
          long_distance_experience?:
            | Database["public"]["Enums"]["long_distance_experience"]
            | null
          profile_completed_at?: string | null
          representative_distance_km?: number | null
          representative_duration_seconds?: number | null
          representative_effort_date?: string | null
          representative_effort_label?: string | null
          representative_elevation_gain_m?: number | null
          updated_at?: string
          user_id: string
          weekly_distance_km?: number | null
          weekly_elevation_gain_m?: number | null
        }
        Update: {
          climb_comfort?: Database["public"]["Enums"]["profile_comfort"] | null
          created_at?: string
          descent_comfort?:
            | Database["public"]["Enums"]["profile_comfort"]
            | null
          fallback_trail_pace_seconds_per_km?: number | null
          long_distance_experience?:
            | Database["public"]["Enums"]["long_distance_experience"]
            | null
          profile_completed_at?: string | null
          representative_distance_km?: number | null
          representative_duration_seconds?: number | null
          representative_effort_date?: string | null
          representative_effort_label?: string | null
          representative_elevation_gain_m?: number | null
          updated_at?: string
          user_id?: string
          weekly_distance_km?: number | null
          weekly_elevation_gain_m?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "trail_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_nutrition_products: {
        Row: {
          created_at: string
          custom_brand: string | null
          custom_caffeine_mg: number | null
          custom_carbs_g: number | null
          custom_hydration_ml: number | null
          custom_name: string | null
          custom_serving_label: string | null
          custom_sodium_mg: number | null
          favorite: boolean
          id: string
          nutrition_product_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          custom_brand?: string | null
          custom_caffeine_mg?: number | null
          custom_carbs_g?: number | null
          custom_hydration_ml?: number | null
          custom_name?: string | null
          custom_serving_label?: string | null
          custom_sodium_mg?: number | null
          favorite?: boolean
          id?: string
          nutrition_product_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          custom_brand?: string | null
          custom_caffeine_mg?: number | null
          custom_carbs_g?: number | null
          custom_hydration_ml?: number | null
          custom_name?: string | null
          custom_serving_label?: string | null
          custom_sodium_mg?: number | null
          favorite?: boolean
          id?: string
          nutrition_product_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_nutrition_products_nutrition_product_id_fkey"
            columns: ["nutrition_product_id"]
            isOneToOne: false
            referencedRelation: "nutrition_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_nutrition_products_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          first_name: string | null
          id: string
          last_name: string | null
          locale: string
          platform_role: Database["public"]["Enums"]["platform_role"]
          timezone: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          first_name?: string | null
          id: string
          last_name?: string | null
          locale?: string
          platform_role?: Database["public"]["Enums"]["platform_role"]
          timezone?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          locale?: string
          platform_role?: Database["public"]["Enums"]["platform_role"]
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      weather_forecast_points: {
        Row: {
          apparent_temperature_c: number | null
          created_at: string
          fetched_at: string
          forecast_issued_at: string | null
          id: string
          latitude: number
          longitude: number
          outing_waypoint_id: string | null
          planned_datetime: string
          point_key: string
          precipitation_amount_mm: number | null
          precipitation_probability_pct: number | null
          provider_payload: Json | null
          race_waypoint_id: string | null
          route_altitude_m: number | null
          temperature_c: number | null
          virtual_segment_id: string | null
          weather_code: string | null
          weather_run_id: string
          wind_direction_deg: number | null
          wind_gust_kmh: number | null
          wind_speed_kmh: number | null
        }
        Insert: {
          apparent_temperature_c?: number | null
          created_at?: string
          fetched_at: string
          forecast_issued_at?: string | null
          id?: string
          latitude: number
          longitude: number
          outing_waypoint_id?: string | null
          planned_datetime: string
          point_key: string
          precipitation_amount_mm?: number | null
          precipitation_probability_pct?: number | null
          provider_payload?: Json | null
          race_waypoint_id?: string | null
          route_altitude_m?: number | null
          temperature_c?: number | null
          virtual_segment_id?: string | null
          weather_code?: string | null
          weather_run_id: string
          wind_direction_deg?: number | null
          wind_gust_kmh?: number | null
          wind_speed_kmh?: number | null
        }
        Update: {
          apparent_temperature_c?: number | null
          created_at?: string
          fetched_at?: string
          forecast_issued_at?: string | null
          id?: string
          latitude?: number
          longitude?: number
          outing_waypoint_id?: string | null
          planned_datetime?: string
          point_key?: string
          precipitation_amount_mm?: number | null
          precipitation_probability_pct?: number | null
          provider_payload?: Json | null
          race_waypoint_id?: string | null
          route_altitude_m?: number | null
          temperature_c?: number | null
          virtual_segment_id?: string | null
          weather_code?: string | null
          weather_run_id?: string
          wind_direction_deg?: number | null
          wind_gust_kmh?: number | null
          wind_speed_kmh?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "weather_forecast_points_outing_waypoint_id_fkey"
            columns: ["outing_waypoint_id"]
            isOneToOne: false
            referencedRelation: "outing_waypoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weather_forecast_points_race_waypoint_id_fkey"
            columns: ["race_waypoint_id"]
            isOneToOne: false
            referencedRelation: "race_waypoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weather_forecast_points_virtual_segment_id_fkey"
            columns: ["virtual_segment_id"]
            isOneToOne: false
            referencedRelation: "race_segments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weather_forecast_points_weather_run_id_fkey"
            columns: ["weather_run_id"]
            isOneToOne: false
            referencedRelation: "weather_forecast_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      weather_forecast_runs: {
        Row: {
          completeness_status: Database["public"]["Enums"]["weather_run_completeness"]
          conditions_config_version: string | null
          conditions_engine_version: string | null
          created_at: string
          failure_code: string | null
          fetched_at: string
          forecast_issued_at: string | null
          id: string
          input_hash: string | null
          input_snapshot: Json
          normalizer_version: string | null
          outing_id: string | null
          provider: string
          provider_config_version: string | null
          provider_model: string | null
          race_plan_id: string | null
          sampling_config_version: string | null
          scope: Database["public"]["Enums"]["weather_scope"]
          status: Database["public"]["Enums"]["weather_run_status"]
          timezone: string
        }
        Insert: {
          completeness_status?: Database["public"]["Enums"]["weather_run_completeness"]
          conditions_config_version?: string | null
          conditions_engine_version?: string | null
          created_at?: string
          failure_code?: string | null
          fetched_at?: string
          forecast_issued_at?: string | null
          id?: string
          input_hash?: string | null
          input_snapshot?: Json
          normalizer_version?: string | null
          outing_id?: string | null
          provider: string
          provider_config_version?: string | null
          provider_model?: string | null
          race_plan_id?: string | null
          sampling_config_version?: string | null
          scope: Database["public"]["Enums"]["weather_scope"]
          status?: Database["public"]["Enums"]["weather_run_status"]
          timezone: string
        }
        Update: {
          completeness_status?: Database["public"]["Enums"]["weather_run_completeness"]
          conditions_config_version?: string | null
          conditions_engine_version?: string | null
          created_at?: string
          failure_code?: string | null
          fetched_at?: string
          forecast_issued_at?: string | null
          id?: string
          input_hash?: string | null
          input_snapshot?: Json
          normalizer_version?: string | null
          outing_id?: string | null
          provider?: string
          provider_config_version?: string | null
          provider_model?: string | null
          race_plan_id?: string | null
          sampling_config_version?: string | null
          scope?: Database["public"]["Enums"]["weather_scope"]
          status?: Database["public"]["Enums"]["weather_run_status"]
          timezone?: string
        }
        Relationships: [
          {
            foreignKeyName: "weather_forecast_runs_outing_id_fkey"
            columns: ["outing_id"]
            isOneToOne: false
            referencedRelation: "outings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weather_forecast_runs_race_plan_id_fkey"
            columns: ["race_plan_id"]
            isOneToOne: false
            referencedRelation: "race_plans"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      assistance_item_type:
        | "bag"
        | "equipment"
        | "nutrition"
        | "instruction"
        | "other"
      assistance_status: "to_define" | "autonomous" | "enabled"
      assistant_status: "active" | "inactive"
      attention_level: "todo" | "verify" | "know"
      bag_item_type: "equipment" | "nutrition" | "free_text"
      bag_type: "start" | "drop_bag" | "assistance" | "finish" | "other"
      change_impact_status: "pending" | "seen" | "reviewed" | "not_applicable"
      change_severity: "info" | "important" | "critical"
      community_category:
        | "preparation"
        | "race"
        | "logistics"
        | "equipment_nutrition"
        | "assistance"
        | "review"
        | "other"
      community_content_status: "published" | "hidden" | "deleted"
      condition_range_source:
        | "manual"
        | "weather_proposal"
        | "strategy_template"
      condition_source: "weather" | "astronomy"
      coverage_label: "limited" | "partial" | "good"
      cutoff_margin_status: "comfortable" | "watch" | "critical" | "beyond"
      cutoff_type: "hard" | "soft"
      detected_condition_type:
        | "heat"
        | "cold"
        | "cold_wind"
        | "rain"
        | "night"
        | "other"
      dispersion_label: "low" | "medium" | "high"
      edition_status:
        | "draft"
        | "published"
        | "completed"
        | "cancelled"
        | "archived"
      enrichment_match_status:
        | "pending"
        | "matched"
        | "review"
        | "unmatched"
        | "ignored"
      enrichment_provider: "itra" | "utmb"
      entitlement_kind: "race_pass" | "plus" | "organizer_included"
      entitlement_scope_type: "global" | "participant_race"
      entitlement_source:
        | "checkout"
        | "organization"
        | "admin"
        | "promo"
        | "purchase"
        | "subscription"
        | "beta"
        | "support"
        | "migration"
        | "promotion"
      entitlement_status: "active" | "expired" | "revoked" | "pending"
      equipment_category:
        | "mandatory_safety"
        | "clothing"
        | "hydration"
        | "nutrition"
        | "electronics"
        | "navigation"
        | "accessory"
        | "other"
      equipment_origin:
        | "official_requirement"
        | "personal"
        | "pluka_suggestion"
        | "conditions"
      equipment_status: "planned" | "packed" | "missing" | "not_needed"
      fact_category:
        | "general"
        | "start"
        | "bib"
        | "course"
        | "gpx"
        | "aid"
        | "cutoff"
        | "equipment"
        | "assistance"
        | "bag"
        | "transport"
        | "safety"
        | "withdrawal"
        | "rules"
        | "contact"
        | "weather"
        | "other"
      fact_workflow_status:
        | "draft"
        | "validated"
        | "published"
        | "rejected"
        | "superseded"
      feedback_rating: "worked" | "partial" | "failed" | "not_used"
      import_row_status: "pending" | "valid" | "error" | "imported" | "skipped"
      import_status:
        | "uploaded"
        | "mapping"
        | "validating"
        | "imported"
        | "failed"
      invitation_status:
        | "pending"
        | "sent"
        | "opened"
        | "activated"
        | "expired"
        | "revoked"
      long_distance_experience:
        | "none"
        | "up_to_30k"
        | "30_60k"
        | "60_100k"
        | "100k_plus"
      management_status: "community" | "pluka_managed" | "organizer_managed"
      message_role: "user" | "assistant" | "system"
      notice_severity: "info" | "important" | "critical"
      notice_type:
        | "information"
        | "safety"
        | "equipment"
        | "weather"
        | "route_change"
        | "start_change"
        | "transport"
        | "cancellation"
        | "other"
      nutrition_action: "consume" | "refill" | "carry"
      nutrition_condition_type: "hot" | "cold" | "night"
      nutrition_feedback: "adapted" | "adjust" | "not_followed"
      nutrition_product_category:
        | "gel"
        | "drink"
        | "bar"
        | "chew"
        | "solid"
        | "salty"
        | "generic_aid"
        | "other"
      nutrition_product_status: "draft" | "validated" | "archived"
      nutrition_recalculation_status: "proposed" | "applied" | "rejected"
      nutrition_waypoint_origin:
        | "plan_waypoint"
        | "outing_waypoint"
        | "generated_checkpoint"
        | "manual"
      organization_member_role: "owner" | "admin" | "editor" | "viewer"
      organization_status: "prospect" | "active" | "suspended" | "archived"
      outing_point_type:
        | "start"
        | "water"
        | "aid"
        | "summit"
        | "pass"
        | "other"
        | "finish"
      outing_status:
        | "draft"
        | "planned"
        | "completed"
        | "cancelled"
        | "archived"
      overall_feeling: "very_good" | "good" | "difficult" | "very_difficult"
      participant_race_status:
        | "active"
        | "finished"
        | "dns"
        | "dnf"
        | "archived"
      plan_accuracy: "realistic" | "optimistic" | "prudent" | "not_relevant"
      plan_dependency_type:
        | "course_fact"
        | "cutoff"
        | "equipment"
        | "assistance"
        | "waypoint"
        | "rule"
        | "other"
      plan_status: "active" | "superseded" | "archived"
      platform_role: "user" | "pluka_admin"
      preparation_state:
        | "to_prepare"
        | "preparing"
        | "ready"
        | "completed"
        | "dns"
        | "dnf"
      profile_comfort: "low" | "medium" | "high"
      proposal_status: "pending" | "applied" | "dismissed" | "expired"
      proposal_target_module: "nutrition" | "preparation"
      purchase_status: "pending" | "paid" | "refunded" | "failed" | "cancelled"
      race_intelligence_mode: "demo" | "beta" | "production"
      race_intelligence_status: "queued" | "running" | "completed" | "failed"
      race_status:
        | "draft"
        | "published"
        | "completed"
        | "cancelled"
        | "archived"
      race_visibility: "private" | "unlisted" | "public"
      reaction_type: "useful"
      record_status: "draft" | "published" | "archived"
      registration_source:
        | "direct"
        | "organizer_import"
        | "organizer_invitation"
        | "admin"
      report_reason: "spam" | "abuse" | "misinformation" | "privacy" | "other"
      report_status: "open" | "reviewed" | "resolved" | "dismissed"
      requirement_type: "mandatory" | "conditional" | "recommended"
      result_status: "finisher" | "dnf" | "cutoff" | "dns"
      segment_type: "official_section" | "computed_section" | "weather_virtual"
      sensitivity_label: "normal" | "watch" | "high"
      source_status: "uploaded" | "processing" | "ready" | "failed" | "archived"
      source_type: "url" | "pdf" | "gpx" | "file" | "manual" | "organizer_input"
      sport_type: "trail" | "road_running" | "cycling" | "triathlon" | "other"
      task_origin:
        | "personal"
        | "pluka"
        | "official_change"
        | "nutrition"
        | "conditions"
      template_type: "nutrition_strategy" | "bag" | "preparation" | "other"
      trust_level: "community" | "pluka_validated" | "official"
      waypoint_type:
        | "start"
        | "aid_station"
        | "water"
        | "checkpoint"
        | "cutoff"
        | "assistance"
        | "summit"
        | "pass"
        | "finish"
        | "other"
      weather_run_completeness: "unknown" | "complete" | "partial"
      weather_run_status: "active" | "stale" | "failed"
      weather_scope: "race_plan" | "outing"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      assistance_item_type: [
        "bag",
        "equipment",
        "nutrition",
        "instruction",
        "other",
      ],
      assistance_status: ["to_define", "autonomous", "enabled"],
      assistant_status: ["active", "inactive"],
      attention_level: ["todo", "verify", "know"],
      bag_item_type: ["equipment", "nutrition", "free_text"],
      bag_type: ["start", "drop_bag", "assistance", "finish", "other"],
      change_impact_status: ["pending", "seen", "reviewed", "not_applicable"],
      change_severity: ["info", "important", "critical"],
      community_category: [
        "preparation",
        "race",
        "logistics",
        "equipment_nutrition",
        "assistance",
        "review",
        "other",
      ],
      community_content_status: ["published", "hidden", "deleted"],
      condition_range_source: [
        "manual",
        "weather_proposal",
        "strategy_template",
      ],
      condition_source: ["weather", "astronomy"],
      coverage_label: ["limited", "partial", "good"],
      cutoff_margin_status: ["comfortable", "watch", "critical", "beyond"],
      cutoff_type: ["hard", "soft"],
      detected_condition_type: [
        "heat",
        "cold",
        "cold_wind",
        "rain",
        "night",
        "other",
      ],
      dispersion_label: ["low", "medium", "high"],
      edition_status: [
        "draft",
        "published",
        "completed",
        "cancelled",
        "archived",
      ],
      enrichment_match_status: [
        "pending",
        "matched",
        "review",
        "unmatched",
        "ignored",
      ],
      enrichment_provider: ["itra", "utmb"],
      entitlement_kind: ["race_pass", "plus", "organizer_included"],
      entitlement_scope_type: ["global", "participant_race"],
      entitlement_source: [
        "checkout",
        "organization",
        "admin",
        "promo",
        "purchase",
        "subscription",
        "beta",
        "support",
        "migration",
        "promotion",
      ],
      entitlement_status: ["active", "expired", "revoked", "pending"],
      equipment_category: [
        "mandatory_safety",
        "clothing",
        "hydration",
        "nutrition",
        "electronics",
        "navigation",
        "accessory",
        "other",
      ],
      equipment_origin: [
        "official_requirement",
        "personal",
        "pluka_suggestion",
        "conditions",
      ],
      equipment_status: ["planned", "packed", "missing", "not_needed"],
      fact_category: [
        "general",
        "start",
        "bib",
        "course",
        "gpx",
        "aid",
        "cutoff",
        "equipment",
        "assistance",
        "bag",
        "transport",
        "safety",
        "withdrawal",
        "rules",
        "contact",
        "weather",
        "other",
      ],
      fact_workflow_status: [
        "draft",
        "validated",
        "published",
        "rejected",
        "superseded",
      ],
      feedback_rating: ["worked", "partial", "failed", "not_used"],
      import_row_status: ["pending", "valid", "error", "imported", "skipped"],
      import_status: [
        "uploaded",
        "mapping",
        "validating",
        "imported",
        "failed",
      ],
      invitation_status: [
        "pending",
        "sent",
        "opened",
        "activated",
        "expired",
        "revoked",
      ],
      long_distance_experience: [
        "none",
        "up_to_30k",
        "30_60k",
        "60_100k",
        "100k_plus",
      ],
      management_status: ["community", "pluka_managed", "organizer_managed"],
      message_role: ["user", "assistant", "system"],
      notice_severity: ["info", "important", "critical"],
      notice_type: [
        "information",
        "safety",
        "equipment",
        "weather",
        "route_change",
        "start_change",
        "transport",
        "cancellation",
        "other",
      ],
      nutrition_action: ["consume", "refill", "carry"],
      nutrition_condition_type: ["hot", "cold", "night"],
      nutrition_feedback: ["adapted", "adjust", "not_followed"],
      nutrition_product_category: [
        "gel",
        "drink",
        "bar",
        "chew",
        "solid",
        "salty",
        "generic_aid",
        "other",
      ],
      nutrition_product_status: ["draft", "validated", "archived"],
      nutrition_recalculation_status: ["proposed", "applied", "rejected"],
      nutrition_waypoint_origin: [
        "plan_waypoint",
        "outing_waypoint",
        "generated_checkpoint",
        "manual",
      ],
      organization_member_role: ["owner", "admin", "editor", "viewer"],
      organization_status: ["prospect", "active", "suspended", "archived"],
      outing_point_type: [
        "start",
        "water",
        "aid",
        "summit",
        "pass",
        "other",
        "finish",
      ],
      outing_status: ["draft", "planned", "completed", "cancelled", "archived"],
      overall_feeling: ["very_good", "good", "difficult", "very_difficult"],
      participant_race_status: ["active", "finished", "dns", "dnf", "archived"],
      plan_accuracy: ["realistic", "optimistic", "prudent", "not_relevant"],
      plan_dependency_type: [
        "course_fact",
        "cutoff",
        "equipment",
        "assistance",
        "waypoint",
        "rule",
        "other",
      ],
      plan_status: ["active", "superseded", "archived"],
      platform_role: ["user", "pluka_admin"],
      preparation_state: [
        "to_prepare",
        "preparing",
        "ready",
        "completed",
        "dns",
        "dnf",
      ],
      profile_comfort: ["low", "medium", "high"],
      proposal_status: ["pending", "applied", "dismissed", "expired"],
      proposal_target_module: ["nutrition", "preparation"],
      purchase_status: ["pending", "paid", "refunded", "failed", "cancelled"],
      race_intelligence_mode: ["demo", "beta", "production"],
      race_intelligence_status: ["queued", "running", "completed", "failed"],
      race_status: ["draft", "published", "completed", "cancelled", "archived"],
      race_visibility: ["private", "unlisted", "public"],
      reaction_type: ["useful"],
      record_status: ["draft", "published", "archived"],
      registration_source: [
        "direct",
        "organizer_import",
        "organizer_invitation",
        "admin",
      ],
      report_reason: ["spam", "abuse", "misinformation", "privacy", "other"],
      report_status: ["open", "reviewed", "resolved", "dismissed"],
      requirement_type: ["mandatory", "conditional", "recommended"],
      result_status: ["finisher", "dnf", "cutoff", "dns"],
      segment_type: ["official_section", "computed_section", "weather_virtual"],
      sensitivity_label: ["normal", "watch", "high"],
      source_status: ["uploaded", "processing", "ready", "failed", "archived"],
      source_type: ["url", "pdf", "gpx", "file", "manual", "organizer_input"],
      sport_type: ["trail", "road_running", "cycling", "triathlon", "other"],
      task_origin: [
        "personal",
        "pluka",
        "official_change",
        "nutrition",
        "conditions",
      ],
      template_type: ["nutrition_strategy", "bag", "preparation", "other"],
      trust_level: ["community", "pluka_validated", "official"],
      waypoint_type: [
        "start",
        "aid_station",
        "water",
        "checkpoint",
        "cutoff",
        "assistance",
        "summit",
        "pass",
        "finish",
        "other",
      ],
      weather_run_completeness: ["unknown", "complete", "partial"],
      weather_run_status: ["active", "stale", "failed"],
      weather_scope: ["race_plan", "outing"],
    },
  },
} as const

