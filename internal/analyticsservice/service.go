package analyticsservice

type AnalyticsService struct{}

func (s *AnalyticsService) Ready() (bool, error) { return true, nil }
