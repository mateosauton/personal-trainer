import AsyncStorage from '@react-native-async-storage/async-storage';
import { WorkoutStore } from './workout-store';
export const workouts = new WorkoutStore(AsyncStorage);
