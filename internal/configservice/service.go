package configservice

type ConfigService struct{}

func (s *ConfigService) Ready() (bool, error) { return true, nil }
