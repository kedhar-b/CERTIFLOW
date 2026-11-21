import { z } from "zod";

export const roleSchema = z.enum(["CENTRE_OPERATOR", "DISTRICT_OFFICER", "QUALITY_OFFICER", "STATE_OFFICER", "ADMIN"]);

export interface SessionUser {
  id: string;
  role: z.infer<typeof roleSchema>;
  districtId: string | null;
  centreId: string | null;
}
