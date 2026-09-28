/** Explicit authoring ablation, not a runtime rule or automatic memory parser. */
import type { ApartmentSitcom } from "../demo/apartment-sitcom";
import { ELAINE_DAVID_APPOINTMENT } from "../demo/cookie-character-history";
import { Schedule } from "../ecs/components";
import { readSimulationTime } from "../ecs/simulation-time";
import { getSchedule, initializeSchedule, type ScheduledActivity } from "../cognition/schedule-system";

export function authorPhoneAppointmentSchedule(bed: ApartmentSitcom): void {
  const world = bed.sim.world, appointment = ELAINE_DAVID_APPOINTMENT;
  if (bed.options.cookieHistory !== "david-appointment" || readSimulationTime(world) !== 0
    || world.time.simulationDay !== appointment.day) throw new Error("Appointment schedule is initial known-appointment fixture data only");
  const previous = getSchedule(world, bed.ids.Elaine);
  const activities: ScheduledActivity[] = previous === undefined ? [] : JSON.parse(Schedule.activities[previous]);
  if (activities.some(a => a.name === "Coffee with David")) throw new Error("Appointment already authored");
  const flexibility = previous === undefined ? 0.5 : Schedule.flexibility[previous];
  initializeSchedule(world, bed.ids.Elaine, [{
    name: "Coffee with David", startHour: appointment.hour, duration: 1,
    location: appointment.place, priority: 7, interruptible: true,
    description: "David and I agreed yesterday to meet for coffee at 16:00. I said I would text if delayed.",
  }, ...activities], flexibility);
}
