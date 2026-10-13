// Generado con `supabase gen types typescript --local --schema public` (Planes y cuentas, Fase 2, 2026-10-01;
// whatsapp_register_inbound sin bot_enabled, 20261001000003; whatsapp_disabled_replies y
// whatsapp_claim_disabled_reply, 20261001000005; whatsapp_release_disabled_reply, 20261001000006;
// Stripe: columnas de accounts, stripe_events y stripe_apply_subscription, 20261007000001).
// Se conserva a mano el bloque __InternalSupabase del archivo anterior y la
// nulabilidad de max_clinics/max_doctors (account_entitlements y my_entitlements).
// Mantener fiel a supabase/migrations/*; `npm run db:types` lo regenera.

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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          billing_status: string | null
          bot_addon: boolean
          created_at: string
          extra_clinics: number
          id: string
          name: string
          plan: Database["public"]["Enums"]["account_plan"]
          stripe_checkout_session_id: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
        }
        Insert: {
          billing_status?: string | null
          bot_addon?: boolean
          created_at?: string
          extra_clinics?: number
          id?: string
          name: string
          plan: Database["public"]["Enums"]["account_plan"]
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
        }
        Update: {
          billing_status?: string | null
          bot_addon?: boolean
          created_at?: string
          extra_clinics?: number
          id?: string
          name?: string
          plan?: Database["public"]["Enums"]["account_plan"]
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
        }
        Relationships: []
      }
      appointments: {
        Row: {
          clinic_id: string
          created_at: string
          created_by: string | null
          dentist_id: string
          ends_at: string
          id: string
          patient_id: string
          plan_item_id: string | null
          reason: string | null
          source: Database["public"]["Enums"]["appt_source"]
          starts_at: string
          status: Database["public"]["Enums"]["appt_status"]
        }
        Insert: {
          clinic_id?: string
          created_at?: string
          created_by?: string | null
          dentist_id: string
          ends_at: string
          id?: string
          patient_id: string
          plan_item_id?: string | null
          reason?: string | null
          source?: Database["public"]["Enums"]["appt_source"]
          starts_at: string
          status?: Database["public"]["Enums"]["appt_status"]
        }
        Update: {
          clinic_id?: string
          created_at?: string
          created_by?: string | null
          dentist_id?: string
          ends_at?: string
          id?: string
          patient_id?: string
          plan_item_id?: string | null
          reason?: string | null
          source?: Database["public"]["Enums"]["appt_source"]
          starts_at?: string
          status?: Database["public"]["Enums"]["appt_status"]
        }
        Relationships: [
          {
            foreignKeyName: "appointments_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_created_by_fkey"
            columns: ["created_by", "clinic_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "appointments_dentist_id_fkey"
            columns: ["dentist_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "appointments_patient_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "appointments_plan_item_id_fkey"
            columns: ["plan_item_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "treatment_plan_items"
            referencedColumns: ["id", "clinic_id"]
          },
        ]
      }
      clinical_notes: {
        Row: {
          appointment_id: string | null
          author_id: string
          body: string
          clinic_id: string
          created_at: string
          id: string
          patient_id: string
        }
        Insert: {
          appointment_id?: string | null
          author_id?: string
          body: string
          clinic_id?: string
          created_at?: string
          id?: string
          patient_id: string
        }
        Update: {
          appointment_id?: string | null
          author_id?: string
          body?: string
          clinic_id?: string
          created_at?: string
          id?: string
          patient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinical_notes_appointment_id_fkey"
            columns: ["appointment_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "clinical_notes_author_id_fkey"
            columns: ["author_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "clinical_notes_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_notes_patient_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "clinic_id"]
          },
        ]
      }
      clinics: {
        Row: {
          account_id: string
          business_hours: Json
          created_at: string
          default_appointment_minutes: number
          id: string
          name: string
          reception_email: string | null
          slug: string
          subscription_status: Database["public"]["Enums"]["subscription_status"]
          timezone: string
          whatsapp_from: string | null
        }
        Insert: {
          account_id: string
          business_hours?: Json
          created_at?: string
          default_appointment_minutes?: number
          id?: string
          name: string
          reception_email?: string | null
          slug: string
          subscription_status?: Database["public"]["Enums"]["subscription_status"]
          timezone?: string
          whatsapp_from?: string | null
        }
        Update: {
          account_id?: string
          business_hours?: Json
          created_at?: string
          default_appointment_minutes?: number
          id?: string
          name?: string
          reception_email?: string | null
          slug?: string
          subscription_status?: Database["public"]["Enums"]["subscription_status"]
          timezone?: string
          whatsapp_from?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinics_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          attention_category:
            | Database["public"]["Enums"]["attention_category"]
            | null
          attention_reason: string | null
          bot_paused: boolean
          bot_state: Json
          clinic_id: string
          created_at: string
          escalated_at: string | null
          id: string
          last_message_at: string | null
          needs_attention: boolean
          patient_id: string
          phone: string
          unread_count: number
        }
        Insert: {
          attention_category?:
            | Database["public"]["Enums"]["attention_category"]
            | null
          attention_reason?: string | null
          bot_paused?: boolean
          bot_state?: Json
          clinic_id?: string
          created_at?: string
          escalated_at?: string | null
          id?: string
          last_message_at?: string | null
          needs_attention?: boolean
          patient_id: string
          phone: string
          unread_count?: number
        }
        Update: {
          attention_category?:
            | Database["public"]["Enums"]["attention_category"]
            | null
          attention_reason?: string | null
          bot_paused?: boolean
          bot_state?: Json
          clinic_id?: string
          created_at?: string
          escalated_at?: string | null
          id?: string
          last_message_at?: string | null
          needs_attention?: boolean
          patient_id?: string
          phone?: string
          unread_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversations_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_patient_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "clinic_id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          clinic_id: string
          conversation_id: string
          created_at: string
          direction: Database["public"]["Enums"]["msg_direction"]
          error_code: string | null
          id: string
          sender: Database["public"]["Enums"]["msg_sender"]
          staff_id: string | null
          status: string
          twilio_sid: string | null
        }
        Insert: {
          body: string
          clinic_id?: string
          conversation_id: string
          created_at?: string
          direction: Database["public"]["Enums"]["msg_direction"]
          error_code?: string | null
          id?: string
          sender: Database["public"]["Enums"]["msg_sender"]
          staff_id?: string | null
          status: string
          twilio_sid?: string | null
        }
        Update: {
          body?: string
          clinic_id?: string
          conversation_id?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["msg_direction"]
          error_code?: string | null
          id?: string
          sender?: Database["public"]["Enums"]["msg_sender"]
          staff_id?: string | null
          status?: string
          twilio_sid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "messages_staff_id_fkey"
            columns: ["staff_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id", "clinic_id"]
          },
        ]
      }
      patients: {
        Row: {
          allergies: string | null
          birthdate: string | null
          clinic_id: string
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          notes_admin: string | null
          phone: string | null
          status: Database["public"]["Enums"]["patient_status"]
          updated_at: string
        }
        Insert: {
          allergies?: string | null
          birthdate?: string | null
          clinic_id?: string
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          notes_admin?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["patient_status"]
          updated_at?: string
        }
        Update: {
          allergies?: string | null
          birthdate?: string | null
          clinic_id?: string
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          notes_admin?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["patient_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patients_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          clinic_id: string
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          notes: string | null
          paid_at: string
          patient_id: string
          plan_id: string | null
          received_by: string | null
        }
        Insert: {
          amount: number
          clinic_id?: string
          id?: string
          method: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          paid_at?: string
          patient_id: string
          plan_id?: string | null
          received_by?: string | null
        }
        Update: {
          amount?: number
          clinic_id?: string
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          paid_at?: string
          patient_id?: string
          plan_id?: string | null
          received_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_patient_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "payments_plan_id_fkey"
            columns: ["plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "treatment_plans"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "payments_received_by_fkey"
            columns: ["received_by", "clinic_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id", "clinic_id"]
          },
        ]
      }
      staff: {
        Row: {
          active: boolean
          clinic_id: string
          created_at: string
          email: string
          full_name: string
          id: string
          role: Database["public"]["Enums"]["staff_role"]
        }
        Insert: {
          active?: boolean
          clinic_id?: string
          created_at?: string
          email: string
          full_name: string
          id: string
          role: Database["public"]["Enums"]["staff_role"]
        }
        Update: {
          active?: boolean
          clinic_id?: string
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          role?: Database["public"]["Enums"]["staff_role"]
        }
        Relationships: [
          {
            foreignKeyName: "staff_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_events: {
        Row: {
          event_id: string
          processed_at: string | null
          received_at: string
          type: string
        }
        Insert: {
          event_id: string
          processed_at?: string | null
          received_at?: string
          type: string
        }
        Update: {
          event_id?: string
          processed_at?: string | null
          received_at?: string
          type?: string
        }
        Relationships: []
      }
      treatment_plan_items: {
        Row: {
          clinic_id: string
          id: string
          plan_id: string
          price: number
          sort_order: number
          status: Database["public"]["Enums"]["item_status"]
          tooth: string | null
          treatment_id: string
        }
        Insert: {
          clinic_id?: string
          id?: string
          plan_id: string
          price: number
          sort_order?: number
          status?: Database["public"]["Enums"]["item_status"]
          tooth?: string | null
          treatment_id: string
        }
        Update: {
          clinic_id?: string
          id?: string
          plan_id?: string
          price?: number
          sort_order?: number
          status?: Database["public"]["Enums"]["item_status"]
          tooth?: string | null
          treatment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "treatment_plan_items_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_plan_items_plan_id_fkey"
            columns: ["plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "treatment_plans"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "treatment_plan_items_treatment_id_fkey"
            columns: ["treatment_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "treatments"
            referencedColumns: ["id", "clinic_id"]
          },
        ]
      }
      treatment_plans: {
        Row: {
          clinic_id: string
          created_at: string
          dentist_id: string
          id: string
          patient_id: string
          status: Database["public"]["Enums"]["plan_status"]
          title: string
        }
        Insert: {
          clinic_id?: string
          created_at?: string
          dentist_id: string
          id?: string
          patient_id: string
          status?: Database["public"]["Enums"]["plan_status"]
          title: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          dentist_id?: string
          id?: string
          patient_id?: string
          status?: Database["public"]["Enums"]["plan_status"]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "treatment_plans_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_plans_dentist_id_fkey"
            columns: ["dentist_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "treatment_plans_patient_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "clinic_id"]
          },
        ]
      }
      treatments: {
        Row: {
          active: boolean
          clinic_id: string
          default_duration_min: number
          default_price: number
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          clinic_id?: string
          default_duration_min?: number
          default_price?: number
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          clinic_id?: string
          default_duration_min?: number
          default_price?: number
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "treatments_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      user_active_clinic: {
        Row: {
          clinic_id: string
          user_id: string
        }
        Insert: {
          clinic_id: string
          user_id: string
        }
        Update: {
          clinic_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_active_clinic_staff_fkey"
            columns: ["user_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id", "clinic_id"]
          },
        ]
      }
      whatsapp_disabled_replies: {
        Row: {
          clinic_id: string
          last_replied_at: string
          phone: string
        }
        Insert: {
          clinic_id: string
          last_replied_at?: string
          phone: string
        }
        Update: {
          clinic_id?: string
          last_replied_at?: string
          phone?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_disabled_replies_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      patient_balances: {
        Row: {
          balance: number | null
          clinic_id: string | null
          paid: number | null
          patient_id: string | null
          plan_id: string | null
          total: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      account_entitlements: {
        Args: { p_account_id: string }
        Returns: {
          bot_enabled: boolean
          // null = ilimitado (ajuste a mano: el generador no detecta la nulabilidad).
          max_clinics: number | null
          max_doctors: number | null
        }[]
      }
      bot_acquire_turn: {
        Args: { p_conversation_id: string; p_lease_seconds?: number }
        Returns: {
          acquired: boolean
          bot_state: Json
          token: string
        }[]
      }
      bot_release_turn: {
        Args: { p_bot_state?: Json; p_conversation_id: string; p_token: string }
        Returns: boolean
      }
      business_hours_valid: { Args: { p_hours: Json }; Returns: boolean }
      clinic_is_active: { Args: never; Returns: boolean }
      current_clinic_id: { Args: never; Returns: string }
      current_membership: {
        Args: never
        Returns: {
          clinic_id: string
          role: Database["public"]["Enums"]["staff_role"]
        }[]
      }
      current_staff_role: {
        Args: never
        Returns: Database["public"]["Enums"]["staff_role"]
      }
      is_active_member: { Args: { p_clinic_id: string }; Returns: boolean }
      my_clinics: {
        Args: never
        Returns: {
          id: string
          is_active: boolean
          name: string
        }[]
      }
      my_entitlements: {
        Args: never
        Returns: {
          account_id: string
          bot_addon: boolean
          bot_enabled: boolean
          clinic_id: string
          clinics_used: number
          doctors_used: number
          // null = ilimitado (ajuste a mano: el generador no detecta la nulabilidad).
          max_clinics: number | null
          max_doctors: number | null
          max_receptionists_per_clinic: number
          plan: Database["public"]["Enums"]["account_plan"]
          receptionists_used: number
        }[]
      }
      normalize_phone: { Args: { p_phone: string }; Returns: string }
      staff_in_other_account: {
        Args: { p_clinic_id: string; p_user_id: string }
        Returns: boolean
      }
      stripe_apply_subscription: {
        Args: {
          p_account_id: string
          p_billing_status: string
          p_bot_addon: boolean
          p_clinic_status: Database["public"]["Enums"]["subscription_status"]
          p_customer_id: string
          p_extra_clinics: number
          p_plan: Database["public"]["Enums"]["account_plan"]
          p_subscription_id: string
        }
        Returns: undefined
      }
      whatsapp_claim_disabled_reply: {
        Args: { p_clinic_id: string; p_from: string }
        Returns: boolean
      }
      whatsapp_release_disabled_reply: {
        Args: { p_clinic_id: string; p_from: string }
        Returns: undefined
      }
      whatsapp_register_inbound: {
        Args: {
          p_body: string
          p_from: string
          p_message_sid: string
          p_to: string
        }
        Returns: {
          bot_paused: boolean
          clinic_active: boolean
          clinic_id: string
          conversation_id: string
          message_id: string
          patient_id: string
          status: string
        }[]
      }
      whatsapp_update_status: {
        Args: { p_error_code?: string; p_sid: string; p_status: string }
        Returns: boolean
      }
    }
    Enums: {
      account_plan: "basic" | "pro" | "plus"
      appt_source: "panel" | "whatsapp"
      appt_status:
        | "scheduled"
        | "confirmed"
        | "completed"
        | "cancelled"
        | "no_show"
      attention_category:
        | "human_requested"
        | "urgent"
        | "policy"
        | "not_understood"
        | "other"
      item_status: "pending" | "in_progress" | "done" | "cancelled"
      msg_direction: "in" | "out"
      msg_sender: "patient" | "bot" | "staff"
      patient_status: "active" | "unidentified"
      payment_method: "cash" | "card" | "transfer"
      plan_status: "draft" | "active" | "completed" | "cancelled"
      staff_role: "owner" | "dentist" | "receptionist"
      subscription_status: "trial" | "active" | "past_due" | "canceled"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_plan: ["basic", "pro", "plus"],
      appt_source: ["panel", "whatsapp"],
      appt_status: [
        "scheduled",
        "confirmed",
        "completed",
        "cancelled",
        "no_show",
      ],
      attention_category: [
        "human_requested",
        "urgent",
        "policy",
        "not_understood",
        "other",
      ],
      item_status: ["pending", "in_progress", "done", "cancelled"],
      msg_direction: ["in", "out"],
      msg_sender: ["patient", "bot", "staff"],
      patient_status: ["active", "unidentified"],
      payment_method: ["cash", "card", "transfer"],
      plan_status: ["draft", "active", "completed", "cancelled"],
      staff_role: ["owner", "dentist", "receptionist"],
      subscription_status: ["trial", "active", "past_due", "canceled"],
    },
  },
} as const
