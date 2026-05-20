export interface Competition {
  id: string;
  title: string;
  shortDescription: string;
  url: string;
  source: string;
  imageUrl?: string;
  deadline: string;
  category: string;
  tags: string[];
  isUpcoming: boolean;
}
