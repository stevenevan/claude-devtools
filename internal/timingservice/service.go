package timingservice

type TimingService struct{}

func (s *TimingService) Ready() (bool, error) { return true, nil }
