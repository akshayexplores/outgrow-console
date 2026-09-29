-- Sensitivity tags (Internal-restricted / Personal data) copied from the data dictionary, plus the columns this build classes as
-- restricted (actions.estimated_value_usd, success_stories.value_usd, opportunities.competitor_ids). tests/rls.sql iterates these.

comment on column public.accounts.lifetime_billed_usd is 'Sum of revenue_periods. | source=Derived req=N phase=MVP sensitivity=Internal-restricted';
comment on column public.accounts.ttm_billed_usd is 'Sum of last 12 revenue_periods. | WHY: Denominator for tiering and for share of wallet. | source=Derived req=N phase=V1 sensitivity=Internal-restricted';
comment on column public.accounts.revenue_trend is 'Growing / Flat / Decreasing / Stopped. Last 3 months vs prior 3, and YoY. | WHY: Feeds the Decreasing, Autopilot and Stopped-buying lists - the plumbing Zoho never had. | source=Derived req=N phase=V1 sensitivity=Internal-restricted | picklist=PL_REVENUE_TREND';
comment on column public.accounts.ext_eng_spend_usd is 'Customer''s estimated annual outsourced engineering spend. | WHY: Makes the wallet-share gap visible on paper - ''the number that changes behaviour''. | source=User req=N phase=MVP sensitivity=Internal-restricted';
comment on column public.accounts.share_of_wallet_pct is 'Latest customer-stated reading, else ttm_billed / ext_eng_spend. | source=Derived req=N phase=MVP sensitivity=Internal-restricted';
comment on column public.org_units.known_budget_usd is 'If learned. | source=User req=N phase=MVP sensitivity=Internal-restricted';
comment on column public.contacts.email is 'Identity & de-dup. Email is never an Outgrow action channel. | source=User req=N phase=MVP sensitivity=Personal data';
comment on column public.contacts.phone_office is ' | source=User req=N phase=MVP sensitivity=Personal data';
comment on column public.contacts.phone_mobile is 'Check channel rules before use (DE/JP/KR). | source=User req=N phase=MVP sensitivity=Personal data';
comment on column public.contacts.messaging_handle is 'Handle on the near-synchronous channel used in their geography. | source=User req=N phase=MVP sensitivity=Personal data';
comment on column public.contacts.linkedin_url is 'Job-change monitoring. | source=User req=N phase=MVP sensitivity=Personal data';
comment on column public.contacts.opt_out_channels is 'Tool blocks assignments and warns on logging for these. | WHY: ''Respect opt-out flags on every action'', especially Germany. | source=User req=N phase=MVP sensitivity=Personal data | picklist=PL_CHANNEL';
comment on column public.contacts.legal_basis is 'GDPR / DPDPA basis for holding data. | source=User req=N phase=V1 sensitivity=Personal data | picklist=PL_LEGAL_BASIS';
comment on column public.contacts.rapport_notes is 'Short, business-appropriate notes for the human opening (''How was the Berlin marathon?''). No sensitive categories. | WHY: Open human, then shift to business. | source=User req=N phase=MVP sensitivity=Personal data';
comment on column public.programmes.current_headcount is ' | source=Import req=N phase=MVP sensitivity=Internal-restricted';
comment on column public.programmes.monthly_run_rate_usd is 'Latest revenue_period. | source=Derived req=N phase=MVP sensitivity=Internal-restricted';
comment on column public.revenue_periods.billed_amount is ' | source=Import req=Y phase=V1 sensitivity=Internal-restricted';
comment on column public.revenue_periods.billed_amount_usd is 'Converted at month-end rate. | source=Derived req=Y phase=V1 sensitivity=Internal-restricted';
comment on column public.revenue_periods.billed_headcount is ' | source=Import req=N phase=V1 sensitivity=Internal-restricted';
comment on column public.opportunities.estimated_value_usd is ' | source=User req=Y phase=MVP sensitivity=Internal-restricted';
comment on column public.whitespace_map.competitor_id is 'Required when status = Held by competitor. | source=User req=C phase=MVP sensitivity=Internal-restricted';
comment on column public.whitespace_map.est_annual_value_usd is ' | source=User req=N phase=MVP sensitivity=Internal-restricted';
comment on column public.share_of_wallet_readings.stated_share_pct is 'What the customer said. Rough is fine. | source=User req=Y phase=MVP sensitivity=Internal-restricted';
comment on column public.proof_points.internal_statement is 'May name customers. | source=Admin req=Y phase=MVP sensitivity=Internal-restricted';
comment on column public.happy_customer_interviews.recording_url is ' | source=User req=N phase=MVP sensitivity=Personal data';
comment on column public.competitors.notes is ' | source=Admin req=N phase=MVP sensitivity=Internal-restricted';
comment on column public.scorecard_weeks.est_value_surfaced_usd is 'Self-reported; labelled as such. | source=Derived req=N phase=MVP sensitivity=Internal-restricted';
comment on column public.actions.estimated_value_usd is 'Pipeline value the person typed in the log. | sensitivity=Internal-restricted (added by build)';
comment on column public.success_stories.value_usd is 'Value of the story. | sensitivity=Internal-restricted (added by build)';
comment on column public.opportunities.competitor_ids is 'Competitor intel. | sensitivity=Internal-restricted (added by build)';
